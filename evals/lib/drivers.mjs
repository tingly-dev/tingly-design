// The agent that does the task: Claude Code, headless (`claude -p`), once per route. A route is a way of
// using Tingly Design; it decides what the agent is told and which tools it may use:
//   skill  the command line, with the format references installed the way `tingly-design skills add` ships them
//   mcp    the MCP server over stdio and nothing else
// The driver is the only part that knows about `claude`; swapping the agent means replacing this file.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Runs a command, returns its exit code and output. `input` goes to stdin. */
export function run(cmd, args, { cwd, env, timeoutMs = 120_000, onLine } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let buf = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d) => {
      out += d;
      if (onLine) {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          onLine(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      }
    });
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out, err });
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: 127, out, err: String(e) });
    });
  });
}

/** The words that start Tingly Design's command line, as the command and its leading arguments. */
export function parseCli(text) {
  const [cmd, ...args] = text.trim().split(/\s+/);
  return { cmd, args, text: text.trim() };
}

const ALLOWED = {
  skill: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill'],
  mcp: ['mcp__tingly-design', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
};

function prompt(route, task, { cli, projects }) {
  if (route === 'skill') {
    return `Tingly Design is installed as a command line: \`${cli.text} --projects ${projects} <command>\` (try \`--help\`). Its projects folder is ${projects}. Its format references are installed as skills in this folder.\n\nTask: ${task.brief}\n\nWhen you are done, reply with one line naming the file you exported.`;
  }
  return `Tingly Design is connected to you as the MCP server "tingly-design". Use it for everything about Tingly Design.\n\nTask: ${task.brief}\n\nWhen you are done, reply with one line naming the file you exported.`;
}

/**
 * One run of one route: sets up an empty workspace (with the skills for `skill`, an MCP config for `mcp`),
 * runs the agent, keeps the transcript. Returns where things are and what the agent said last.
 */
export async function runRoute({ route, task, cli, dir, model, maxTurns = 60, maxBudgetUsd, timeoutMs = 20 * 60_000, onLine }) {
  const ws = join(dir, 'workspace');
  const projects = join(ws, 'projects');
  await mkdir(projects, { recursive: true });
  const env = { DC_PROJECTS: projects };
  const args = ['-p', prompt(route, task, { cli, projects }), '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--setting-sources', 'project', '--max-turns', String(maxTurns), '--allowedTools', ...ALLOWED[route]];
  if (model) args.push('--model', model);
  if (maxBudgetUsd) args.push('--max-budget-usd', String(maxBudgetUsd));
  if (route === 'skill') {
    // the references land in the workspace's .claude/skills, as `tingly-design skills add` leaves them in any repository
    const r = await run(cli.cmd, [...cli.args, '--projects', projects, 'skills', 'add', ws], { env, timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(`skills add failed: ${r.err || r.out}`);
  } else {
    const passEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('DC_')));
    const config = { mcpServers: { 'tingly-design': { command: cli.cmd, args: [...cli.args, 'mcp', '--projects', projects], env: passEnv } } };
    const file = join(dir, 'mcp.json');
    await writeFile(file, JSON.stringify(config, null, 2));
    args.push('--mcp-config', file, '--strict-mcp-config', '--disallowedTools', 'Skill');
  }
  const started = Date.now();
  const lines = [];
  const r = await run('claude', args, { cwd: ws, env, timeoutMs, onLine: (l) => (lines.push(l), onLine?.(l)) });
  const transcript = join(dir, 'transcript.jsonl');
  await writeFile(transcript, lines.join('\n') + '\n');
  return { route, ws, projects, transcript, started, exit: r.code, stderr: r.err.slice(-2000), seconds: Math.round((Date.now() - started) / 1000) };
}

/** A second, independent look at the final picture against the task's rubric: a score 1–5 and a line of notes. */
export async function judge({ task, pictures, dir, model }) {
  const ask = `Read ${pictures.length === 1 ? 'the image' : `all ${pictures.length} images`} at ${pictures.slice(0, 8).join(', ')}. ${pictures.length === 1 ? 'It is' : 'They are'} the result of this brief: "${task.brief}"\n\nJudge only ${pictures.length === 1 ? 'the picture' : 'the pictures'} against this description: ${task.rubric}\n\nReply with a single JSON object and nothing else: {"score": <1-5, 5 is excellent>, "notes": "<one or two sentences naming the biggest flaw>"}`;
  const args = ['-p', ask, '--output-format', 'json', '--allowedTools', 'Read', '--max-turns', '12'];
  if (model) args.push('--model', model);
  const r = await run('claude', args, { cwd: dir, timeoutMs: 180_000 });
  try {
    const text = String(JSON.parse(r.out).result ?? '');
    const m = /\{[\s\S]*\}/.exec(text);
    const v = m ? JSON.parse(m[0]) : null;
    return v && typeof v.score === 'number' ? { score: v.score, notes: String(v.notes ?? '') } : { score: null, notes: text.slice(0, 200) };
  } catch {
    return { score: null, notes: 'the judge did not answer' };
  }
}
