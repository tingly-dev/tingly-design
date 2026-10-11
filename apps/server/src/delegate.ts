import { spawn, spawnSync } from 'node:child_process';
import { relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectDir, REPO_ROOT } from './store';
import { publish } from './hub';

/**
 * The slow agent: Claude Code, run headless in this repository.
 *
 * It edits the canvas files directly with its own tools. It never talks to
 * the editor: the file watcher notices each write and every open editor
 * re-renders, exactly as it would for an edit made in a terminal.
 */

export function claudeAvailable(): boolean {
  try {
    return spawnSync('claude', ['--version'], { timeout: 5000 }).status === 0;
  } catch {
    return false;
  }
}

const SYSTEM = `You are editing a design project stored as files. It is one of two kinds:
- a design canvas: canvas.json (artboard layout, notes) and one *.dc.html file per artboard. Before you change it, read .claude/skills/dc-canvas/SKILL.md in the repository root: it is the full format reference.
- a slide deck: deck.json (title, slide order, sections, fonts) and one slides/<id>.html per slide, each exactly one <section id="<id>"> on a 1920×1080 canvas in a closed HTML/CSS subset. Before you change it, read .claude/skills/slides/SKILL.md in the repository root.
Edit only files inside the project folder you are given, with your Edit and Write tools. Change only what the request asks; the person may have edited these files by hand a moment ago, so read each file right before you edit it.
Never rename or remove handle-like ids: elements in these files have no handle ids; ids such as dc12 in the request are handles the editor added, numbered depth-first over the elements of the template (inside <x-dc> for an artboard, the whole file for a slide).
When done, reply with one short sentence saying what changed. Do not run builds, servers or browsers.`;

/** Which projects have a delegate running, so file changes can be credited to it. */
export const activeDelegates = new Map<string, number>();

export interface DelegateRequest {
  prompt: string;
  file?: string;
  pointed?: { handle: string; tag: string; label: string; snippet?: string } | null;
  journal?: string[];
}

export function startDelegate(project: string, req: DelegateRequest): string {
  const id = randomUUID().slice(0, 8);
  const dir = relative(REPO_ROOT, projectDir(project));
  const lines = [
    `Project folder: ${dir}/`,
    req.file ? `The person is looking at ${req.file.startsWith('slides/') ? 'the slide' : 'the artboard'} ${dir}/${req.file}.` : '',
    req.pointed
      ? `They pointed at ${req.pointed.handle} (<${req.pointed.tag}>${req.pointed.label ? `, "${req.pointed.label}"` : ''}).${req.pointed.snippet ? `\nIts source:\n${req.pointed.snippet}` : ''}`
      : '',
    req.journal?.length ? `Recent changes, oldest first:\n${req.journal.join('\n')}` : '',
    `Request: ${req.prompt}`,
  ].filter(Boolean);

  const args = [
    '-p',
    lines.join('\n\n'),
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    'Read,Edit,Write,Glob,Grep',
    '--append-system-prompt',
    SYSTEM,
  ];
  if (process.env.DC_DELEGATE_MODEL) args.push('--model', process.env.DC_DELEGATE_MODEL);

  activeDelegates.set(project, (activeDelegates.get(project) ?? 0) + 1);
  publish(project, { type: 'delegate', id, state: 'start', text: req.prompt });

  const child = spawn('claude', args, { cwd: REPO_ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const timer = setTimeout(() => child.kill('SIGTERM'), 15 * 60 * 1000);
  let buf = '';
  let final = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'assistant') {
          for (const part of msg.message?.content ?? []) {
            if (part.type === 'text' && part.text?.trim()) {
              publish(project, { type: 'delegate', id, state: 'progress', text: part.text.trim().slice(0, 300) });
            } else if (part.type === 'tool_use') {
              const target = part.input?.file_path ?? part.input?.pattern ?? part.input?.path ?? '';
              publish(project, {
                type: 'delegate',
                id,
                state: 'progress',
                text: `${part.name} ${String(target).replace(REPO_ROOT + '/', '')}`.trim(),
              });
            }
          }
        } else if (msg.type === 'result') {
          final = typeof msg.result === 'string' ? msg.result : '';
          if (msg.is_error) stderr += final;
        }
      } catch {
        // not JSON
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c: string) => {
    stderr += c;
  });
  let finished = false;
  const finish = (ok: boolean, text: string) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    const n = (activeDelegates.get(project) ?? 1) - 1;
    // let the watcher credit the last writes before we stop attributing them
    setTimeout(() => {
      if (n <= 0) activeDelegates.delete(project);
      else activeDelegates.set(project, n);
    }, 1500);
    publish(project, { type: 'delegate', id, state: ok ? 'done' : 'error', text });
  };
  child.on('error', (e) => finish(false, e.message));
  child.on('close', (code) => {
    if (code === 0) finish(true, final || 'Done.');
    else finish(false, (stderr || final || `claude exited with ${code}`).slice(0, 800));
  });
  return id;
}
