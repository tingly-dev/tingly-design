#!/usr/bin/env node
// Agent evaluation: does an agent get a real design task done with Tingly Design, by the command line and
// its skills, or by the MCP server? Runs each task through each route with Claude Code headless, scores
// what was left behind through the command line, and writes one comparison. Independent of the rest of the
// repository: it only talks to Tingly Design's public surfaces (the command line, the MCP server, the
// skills), so it can evaluate a build, the bundle or the npm package as well as the source.
//
//   node evals/run.mjs [--task steep-pricing,steep-pitch] [--route skill,mcp] [--runs 1]
//                      [--cli "<command>"] [--model <name>] [--judge] [--max-budget <usd>] [--out <dir>]
//
// Needs `claude` signed in, and Chrome (DC_CHROME, DC_CHROME_SANDBOX=0 in a container) for the pictures.
// Not part of `pnpm test` or CI: it costs money and takes minutes. See .design/agent-evals.md.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { judge, parseCli, run, runRoute } from './lib/drivers.mjs';
import { summarize, toJson } from './lib/report.mjs';
import { measure, parseLines, purity } from './lib/transcript.mjs';
import { score } from './lib/score.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const { values: o } = parseArgs({
  options: {
    task: { type: 'string' },
    route: { type: 'string', default: 'skill,mcp' },
    runs: { type: 'string', default: '1' },
    cli: { type: 'string' },
    model: { type: 'string' },
    judge: { type: 'boolean', default: false },
    'max-budget': { type: 'string' },
    out: { type: 'string' },
    list: { type: 'boolean', default: false },
  },
});

const tasks = await Promise.all((await readdir(join(here, 'tasks'))).filter((f) => f.endsWith('.json')).map(async (f) => JSON.parse(await readFile(join(here, 'tasks', f), 'utf8'))));
if (o.list) {
  for (const t of tasks) console.log(`${t.id}\t${t.kind}\t${t.brief.slice(0, 90)}…`);
  process.exit(0);
}
const wanted = o.task ? o.task.split(',') : tasks.map((t) => t.id);
const picked = tasks.filter((t) => wanted.includes(t.id));
if (!picked.length) {
  console.error(`No task named ${o.task}. Tasks: ${tasks.map((t) => t.id).join(', ')}`);
  process.exit(2);
}
const routes = o.route.split(',').map((r) => r.trim());
if (routes.some((r) => r !== 'skill' && r !== 'mcp')) {
  console.error('Routes are skill and mcp.');
  process.exit(2);
}

// the command line under test: the source in this repository by default, `--cli "node dist/tingly-design/cli.mjs"` for the bundle
const cli = parseCli(o.cli ?? `pnpm -s --dir ${root} tingly-design`);
const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = resolve(o.out ?? join(here, 'out', id));
await mkdir(out, { recursive: true });
const runs = [];

for (const task of picked) {
  for (const route of routes) {
    for (let n = 1; n <= Number(o.runs); n++) {
      const dir = join(out, task.id, `${route}-${n}`);
      await mkdir(dir, { recursive: true });
      console.error(`▶ ${task.id} · ${route} #${n}`);
      const ran = await runRoute({ route, task, cli, dir, model: o.model, maxBudgetUsd: o['max-budget'] });
      const metrics = measure(parseLines(await readFile(ran.transcript, 'utf8')), { cli: 'tingly-design' });
      const td = (args) => run(cli.cmd, [...cli.args, '--projects', ran.projects, ...args], { env: { DC_PROJECTS: ran.projects }, timeoutMs: 300_000 });
      const scored = await score(task, { dir: join(ran.projects, task.project), td, since: ran.started });
      const verdict = o.judge && scored.finals?.length ? await judge({ task, pictures: scored.finals, dir, model: o.model }) : undefined;
      runs.push({ task: task.id, route, n, ...ran, metrics, purity: purity(metrics, route), score: scored, judge: verdict });
      console.error(`  ${scored.pass ? 'pass' : 'FAIL'} · ${metrics.toolCalls} tool calls · ${ran.seconds}s${metrics.costUsd === null ? '' : ` · $${metrics.costUsd.toFixed(2)}`}`);
    }
  }
}

const meta = { id, cli: cli.text, model: o.model ?? null, runs: Number(o.runs) };
await writeFile(join(out, 'summary.md'), summarize(runs, meta));
await writeFile(join(out, 'summary.json'), JSON.stringify(toJson(runs, meta), null, 2));
console.log(join(out, 'summary.md'));
process.exit(runs.every((r) => r.score.pass) ? 0 : 1);
