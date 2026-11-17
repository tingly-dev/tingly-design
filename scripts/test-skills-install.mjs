#!/usr/bin/env node
// Exercise the real skills CLI without writing into the user's agent directories.
// Usage: node scripts/test-skills-install.mjs /path/to/skills/bin/cli.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = process.argv[2];
if (!cli) throw new Error('Pass the path to the skills CLI bin/cli.mjs');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'tingly-skills-test-'));
const expected = ['dashboard', 'dc-canvas', 'design-system', 'docs', 'motion', 'slides'];
const env = { ...process.env, DO_NOT_TRACK: '1', DISABLE_TELEMETRY: '1', NO_COLOR: '1' };
delete env.INSTALL_INTERNAL_SKILLS;
function run(args, cwd, extraEnv = {}) {
  return execFileSync(process.execPath, [resolve(cli), ...args], { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 30000 });
}
function compareTree(source, destination) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const a = join(source, entry.name), b = join(destination, entry.name);
    if (entry.isDirectory()) compareTree(a, b);
    else assert.deepEqual(readFileSync(b), readFileSync(a), b);
  }
}
try {
  const list = run(['add', root, '--list'], temp);
  for (const name of expected) assert.match(list, new RegExp(`\\b${name}\\b`));
  assert.doesNotMatch(list, /issue-resolve/);
  assert.match(run(['add', root, '--list'], temp, { INSTALL_INTERNAL_SKILLS: '1' }), /issue-resolve/);
  for (const mode of ['link', 'copy']) {
    const dir = join(temp, mode);
    mkdirSync(dir);
    run(['add', root, '--skill', '*', '--agent', 'codex', '-y', ...(mode === 'copy' ? ['--copy'] : [])], dir);
    const installed = join(dir, '.agents', 'skills');
    assert.deepEqual(readdirSync(installed).sort(), expected);
    for (const name of expected) {
      assert.ok(statSync(join(installed, name)).isDirectory());
      compareTree(join(root, '.claude', 'skills', name), join(installed, name));
    }
  }
  console.log('Skills discovery, internal opt-in, link and copy installation passed.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
