#!/usr/bin/env node
/**
 * Runs the original Design canvas editor (artifact/claude-design/type) locally,
 * editable, for study. Reference material only — not part of the product.
 *
 *   node artifact/claude-design/emulator/serve.mjs [workDir] [port]
 *
 * workDir (default: a temp copy) gets index.html, artifact-type/ and project/
 * laid out the way the artifact host publishes them. The page is given a tiny
 * `window.claude` with `self.publish` (writes files here) and a `user` that may
 * edit; everything else the host offers (comments, rooms, db, Claude) is absent.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ref = resolve(here, '..');
const work = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), 'dc-orig-')));
const port = Number(process.argv[3] ?? 8801);

if (!existsSync(join(work, 'index.html'))) {
  mkdirSync(join(work, 'artifact-type'), { recursive: true });
  mkdirSync(join(work, 'project'), { recursive: true });
  cpSync(join(ref, 'type/index.html'), join(work, 'index.html'));
  for (const f of ['app.js', 'app.css', 'dc-runtime.js', 'fast-edit-worker.js']) cpSync(join(ref, 'type', f), join(work, 'artifact-type', f));
  cpSync(join(ref, 'type/reference'), join(work, 'artifact-type/reference'), { recursive: true });
  cpSync(join(ref, 'type/thumbnail'), join(work, 'artifact-type/thumbnail'), { recursive: true });
  cpSync(join(ref, 'sample-canvas'), join(work, 'project'), { recursive: true });
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.md': 'text/markdown', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.webp': 'image/webp', '.txt': 'text/plain',
};
const typeOf = (p) => TYPES[extname(p).toLowerCase()] ?? 'application/octet-stream';
const sha = (b) => createHash('sha256').update(b).digest('hex');
let version = 1;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(relative(work, p).split(sep).join('/'));
  }
  return out;
}

function listing() {
  const files = {};
  for (const p of walk(work)) {
    if (p === 'index.html' || p.startsWith('_')) continue;
    const b = readFileSync(join(work, p));
    files[p] = { sha256: sha(b), size: b.length, contentType: typeOf(p) };
  }
  return { ver: 'local-' + version, files };
}

const SHIM = `<script id="local-claude-shim">(() => {
  const toB64 = async (blob) => { const b = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
  const self = {
    async publish(files) {
      const body = {};
      for (const [p, v] of Object.entries(files)) {
        if (v === null || (v && v.delete)) { body[p] = null; continue; }
        const c = v && typeof v === 'object' && !(v instanceof Blob) ? v.content : v;
        const ct = v && v.contentType;
        body[p] = typeof c === 'string' ? { text: c, contentType: ct } : { base64: await toB64(c), contentType: ct };
      }
      const r = await fetch('/_publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw j;
      return j;
    },
  };
  const user = {
    async canEdit() { return true; },
    async can() { return true; },
    async me() { return { id: 'local', name: 'Local' }; },
  };
  window.claude = { self, user, async use(name) { return this[name] ?? { available: false }; } };
})();</script>`;

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let path = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  if (req.method === 'POST' && path === '_publish') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      const shas = {};
      for (const [p, v] of Object.entries(body)) {
        const abs = resolve(work, p);
        if (!abs.startsWith(work + sep) || !p.startsWith('project/')) {
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ code: 'read_only_path', message: p }));
        }
        if (v === null) {
          rmSync(abs, { force: true });
          continue;
        }
        const buf = v.text !== undefined ? Buffer.from(v.text, 'utf8') : Buffer.from(v.base64, 'base64');
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, buf);
        shas[p] = sha(buf);
      }
      version++;
      console.log(`publish v${version}:`, Object.keys(body).join(', '));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: 'local-' + version, shas }));
    });
    return;
  }
  if (path === '_files.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(listing()));
  }
  const abs = resolve(work, path);
  if (!abs.startsWith(work) || !existsSync(abs) || statSync(abs).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  let body = readFileSync(abs);
  if (path === 'index.html') body = Buffer.from(body.toString('utf8').replace('<head>', '<head>' + SHIM));
  res.writeHead(200, { 'content-type': typeOf(path), 'cache-control': 'no-store' });
  res.end(body);
}).listen(port, '127.0.0.1', () => console.log(`original editor: http://127.0.0.1:${port}/  (files in ${work})`));
