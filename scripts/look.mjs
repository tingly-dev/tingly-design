#!/usr/bin/env node
// See the page you are editing, through the running Tingly Design server, which draws the project in the machine's Chrome as the editor's Export menu does:
//   node scripts/look.mjs <project> [pick]
// <project> is the project's name (a folder path works too: its last part is the name). <pick> is one board (canvas), slide id (slides),
// tab id (docs), view (design-system: overview, colors, type, space, components, assets) or format (motion); without it everything is drawn.
// Prints the path of each picture (a PNG inside the project folder, under renders/look/, for your Read tool) and what the drawing found.
// The server is DC_SERVER_URL (set for Claude Code when the server starts it).
import { basename } from 'node:path';

const [folder, pick] = process.argv.slice(2);
if (!folder) {
  console.error('usage: node scripts/look.mjs <project> [pick]');
  process.exit(2);
}
const server = process.env.DC_SERVER_URL;
if (!server) {
  console.error('DC_SERVER_URL is not set: this script is run by the Tingly Design server for Claude Code');
  process.exit(2);
}
const res = await fetch(`${server}/api/projects/${encodeURIComponent(folder.includes('/') ? basename(folder.replace(/\/+$/, '')) : folder)}/look`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ pick }),
}).catch((e) => ({ ok: false, status: 0, statusText: String(e.message ?? e), json: async () => ({}) }));
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(body.error ?? `${res.status} ${res.statusText}`);
  process.exit(1);
}
for (const f of body.files) console.log(f);
for (const p of body.problems.slice(0, 40)) console.log(`${p.level}: ${p.file}: ${p.text}`);
if (body.problems.length > 40) console.log(`… and ${body.problems.length - 40} more`);
if (!body.files.length) {
  console.error('nothing was drawn' + (pick ? `: no board, slide, tab, view or format "${pick}"?` : ''));
  process.exit(1);
}
