import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { measure, parseLines, purity } from '../lib/transcript.mjs';
import { countItems, exportedFiles, missingWords, score } from '../lib/score.mjs';
import { parseCli } from '../lib/drivers.mjs';

const fixture = (name) => readFile(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

test('an MCP run: tools, rounds, pictures, cost', async () => {
  const m = measure(parseLines(await fixture('mcp-run.jsonl')));
  assert.equal(m.toolCalls, 5);
  assert.equal(m.mcpCalls, 4);
  assert.equal(m.checkRounds, 1);
  assert.equal(m.lookRounds, 1);
  assert.equal(m.exports, 1);
  assert.equal(m.picturesViewed, 1);
  assert.equal(m.errors, 1);
  assert.equal(m.turns, 5);
  assert.equal(m.costUsd, 0.42);
  assert.equal(m.inputTokens, 2010);
  assert.equal(m.cacheReadTokens, 30000);
  assert.equal(m.byTool.Write, 1);
  assert.equal(purity(m, 'mcp'), 'pure');
  assert.equal(purity(m, 'skill'), 'used-mcp');
});

test('a command-line run: shell commands count as rounds, a picture read counts, a torn line is skipped', async () => {
  const m = measure(parseLines(await fixture('skill-run.jsonl')));
  assert.equal(m.shellCalls, 3);
  assert.equal(m.checkRounds, 0);
  assert.equal(m.lookRounds, 1);
  assert.equal(m.exports, 1);
  assert.equal(m.picturesViewed, 1);
  assert.equal(m.skillReads, 1);
  assert.equal(m.mcpCalls, 0);
  assert.equal(purity(m, 'skill'), 'pure');
  assert.equal(purity(m, 'mcp'), 'used-cli');
});

test('parseCli splits a command line into the command and its arguments', () => {
  assert.deepEqual(parseCli('node dist/tingly-design/cli.mjs'), { cmd: 'node', args: ['dist/tingly-design/cli.mjs'], text: 'node dist/tingly-design/cli.mjs' });
});

test('scoring reads the project through the command line and the files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'evals-'));
  await mkdir(join(dir, 'renders', 'check'), { recursive: true });
  await writeFile(join(dir, 'Main.dc.html'), '<h1>Steep</h1><p>Sampler Monthly</p>');
  await writeFile(join(dir, 'renders', 'Main.png'), 'x');
  await writeFile(join(dir, 'renders', 'check', 'Main.png'), 'x');
  assert.deepEqual(await missingWords(dir, ['steep', 'Sampler', 'Connoisseur']), ['Connoisseur']);
  assert.equal((await exportedFiles(dir, 'png', 0)).length, 1);
  assert.equal((await exportedFiles(dir, 'png', Date.now() + 60_000)).length, 0);
  assert.deepEqual(countItems({ items: [{ type: 'board' }, { type: 'board' }, { type: 'note' }] }), { board: 2, note: 1 });

  const task = { project: 'steep', expect: { board: 1 }, mustContain: ['Steep'], export: { as: 'png' } };
  const outline = JSON.stringify({ items: [{ type: 'board' }] });
  const check = JSON.stringify({ problems: [{ level: 'warning', file: 'Main.dc.html', code: 'layout', rule: 'gap' }], snapshots: [join(dir, 'renders', 'check', 'Main.png')] });
  const td = async (args) => (args[0] === 'list' ? { code: 0, out: outline } : { code: 0, out: check });
  const r = await score(task, { dir, td, since: 0 });
  assert.equal(r.pass, true);
  assert.equal(r.warnings.length, 1);
  assert.ok(r.final.endsWith('Main.png'));

  const bad = await score({ ...task, mustContain: ['Nowhere'] }, { dir, td, since: 0 });
  assert.equal(bad.pass, false);
  const errors = await score(task, { dir, td: async (a) => (a[0] === 'list' ? { code: 0, out: outline } : { code: 1, out: JSON.stringify({ problems: [{ level: 'error', file: 'canvas.json', code: 'canvas' }], snapshots: [] }) }), since: 0 });
  assert.equal(errors.pass, false);
});
