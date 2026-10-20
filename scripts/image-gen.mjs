#!/usr/bin/env node
// Make a picture (or change one) through the running Tingly Design server, which holds the image settings:
//   node scripts/image-gen.mjs projects/<name> "a watercolour fox" [--size 1024x1024] [--quality high]
//   node scripts/image-gen.mjs projects/<name> "make the sky a sunset" --edit uploads/fox-1a2b3c4d.png
// Prints the path of the new picture inside the project folder. The server is DC_SERVER_URL (set for Claude Code when the server starts it).
import { basename } from 'node:path';

const argv = process.argv.slice(2);
const flags = {};
const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
  else rest.push(argv[i]);
}
const [folder, prompt] = rest;
if (!folder || !prompt) {
  console.error('usage: node scripts/image-gen.mjs projects/<name> "<description>" [--size 1024x1024] [--quality high] [--edit uploads/<file>]');
  process.exit(2);
}
const server = process.env.DC_SERVER_URL;
if (!server) {
  console.error('DC_SERVER_URL is not set: this script is run by the Tingly Design server for Claude Code');
  process.exit(2);
}
const res = await fetch(`${server}/api/projects/${encodeURIComponent(basename(folder.replace(/\/+$/, '')))}/images`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt, size: flags.size, quality: flags.quality, edit: flags.edit }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(body.error ?? `${res.status} ${res.statusText}`);
  process.exit(1);
}
console.log(body.path);
