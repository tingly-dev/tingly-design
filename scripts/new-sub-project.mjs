#!/usr/bin/env node
// Make a sub-project (a project of its own, inside this project's folder) through the running Tingly Design server:
//   node scripts/new-sub-project.mjs <project> <kind> <folder-name> ["Title"] [--size 1200x760] [--look <id>]
// <kind> is canvas, slides, design-system, dashboard, doc or motion. <project> is the project's name (a folder path works too:
// its last part is the name). Prints the new project's folder: edit the files in it, as its kind's skill says.
// The server is DC_SERVER_URL (set for Claude Code when the server starts it).
import { basename } from 'node:path';

const KINDS = { canvas: 'design', design: 'design', slides: 'slides', 'design-system': 'design-system', dashboard: 'dashboard', doc: 'docs', docs: 'docs', motion: 'motion' };
const argv = process.argv.slice(2);
const flags = {};
const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
  else rest.push(argv[i]);
}
const [folder, kindWord, name, title] = rest;
const kind = KINDS[kindWord];
if (!folder || !kind || !name) {
  console.error('usage: node scripts/new-sub-project.mjs <project> <canvas|slides|design-system|dashboard|doc|motion> <folder-name> ["Title"] [--size 1200x760] [--look <id>]');
  process.exit(2);
}
const size = flags.size ? flags.size.split(/[x×]/i).map(Number) : undefined;
if (flags.size && (size.length !== 2 || size.some((n) => !Number.isFinite(n)))) {
  console.error('--size is a width and a height in pixels, such as 1200x760');
  process.exit(2);
}
const server = process.env.DC_SERVER_URL;
if (!server) {
  console.error('DC_SERVER_URL is not set: this script is run by the Tingly Design server for Claude Code');
  process.exit(2);
}
const res = await fetch(`${server}/api/projects/${encodeURIComponent(folder.includes('/') ? basename(folder.replace(/\/+$/, '')) : folder)}/sub-projects`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name, kind, title, size, look: flags.look }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(body.error ?? `${res.status} ${res.statusText}`);
  process.exit(1);
}
console.log(`${body.folder}/`);
