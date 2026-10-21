import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

let root: string;
let archive: typeof import('../../../apps/server/src/archive');
let store: typeof import('../../../apps/server/src/store');
const fixture = (name: string) => readFile(new URL(`./fixtures/pptx-smoke/${name}.pptx`, import.meta.url)).then(b => new Uint8Array(b));
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dc-pptx-import-'));
  process.env.DC_PROJECTS = root;
  archive = await import('../../../apps/server/src/archive');
  store = await import('../../../apps/server/src/store');
});
afterAll(async () => { delete process.env.DC_PROJECTS; await rm(root, { recursive: true, force: true }); });

describe('PPTX as a new project through the shared archive import', () => {
  it('detects a renamed PPTX from its package and keeps original, report and editable slides', async () => {
    const bytes = await fixture('supported');
    const got = await archive.unpackProject(bytes, 'Renamed.zip');
    expect(got.name).toBe('Renamed');
    expect(got.pptx).toBeDefined();
    const dir = join(root, got.name);
    const deck = JSON.parse(await readFile(join(dir, 'deck.json'), 'utf8'));
    expect(deck.title).toBe('Renamed');
    expect(deck.pptxImport).toBe(got.pptx!.report);
    expect(deck.order.length).toBeGreaterThan(0);
    expect(await readFile(join(dir, got.pptx!.source))).toEqual(Buffer.from(bytes));
    expect(JSON.parse(await readFile(join(dir, got.pptx!.report), 'utf8')).slides).toHaveLength(deck.order.length);
    expect(await readFile(join(dir, `slides/${deck.order[0]}.html`), 'utf8')).toContain('<section');
    expect(await store.kindOf(dir)).toBe('slides');
    expect(store.assetType(got.pptx!.source)).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
  });

  it('refuses unsupported artwork with structured diagnostics and creates no folder', async () => {
    const before = await readdir(root);
    await expect(archive.unpackProject(await fixture('cases/table'), 'chart.pptx')).rejects.toMatchObject({ key: 'pptxUnsupported', diagnostics: expect.arrayContaining([expect.objectContaining({ level: 'error', code: 'unsupported_style', part: expect.any(String) })]) });
    expect(await readdir(root)).toEqual(before);
  });

  it('uses the strict converter even for a renamed hostile OOXML package', async () => {
    const bytes = zipSync({ '[Content_Types].xml': strToU8('bad'), '_rels/.rels': strToU8('bad'), 'ppt/slide.xml': new Uint8Array(17 * 1024 * 1024) });
    await expect(archive.unpackProject(bytes, 'bomb.zip')).rejects.toMatchObject({ key: 'pptxLimit', diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'limit_exceeded' })]) });
    expect((await readdir(root)).some(n => n.startsWith('bomb'))).toBe(false);
  });

  it('gives concurrent imports distinct names without replacing existing projects', async () => {
    await mkdir(join(root, 'parallel'));
    const bytes = await fixture('supported');
    const results = await Promise.all(Array.from({ length: 3 }, () => archive.unpackProject(bytes, 'parallel.pptx')));
    expect(new Set(results.map(r => r.name)).size).toBe(3);
    expect(results.every(r => r.name !== 'parallel')).toBe(true);
    expect(await readdir(join(root, 'parallel'))).toEqual([]);
    expect((await readdir(root)).some(n => n.startsWith('.import-'))).toBe(false);
  });

  it('does not mistake ordinary project ZIPs for PPTX and still imports Markdown', async () => {
    const zip = zipSync({ 'deck/deck.json': strToU8('{"v":4,"title":"Archive","order":[]}') });
    const got = await archive.unpackProject(zip, 'ordinary.zip');
    expect(got.pptx).toBeUndefined();
    expect(await store.kindOf(join(root, got.name))).toBe('slides');
    const doc = await archive.unpackProject(strToU8('# Hello'), 'note.md');
    expect(doc.claudeDesign).toBe('docs');
  });

  it('returns localized actionable API diagnostics and serves the original with PPTX MIME', async () => {
    const { app } = await import('../../../apps/server/src/app');
    const failure = await app.request('/api/archive?file=bad.pptx', { method: 'POST', headers: { 'x-dc-lang': 'zh' }, body: await fixture('cases/table') });
    expect(failure.status).toBe(400);
    const refused = await failure.json();
    expect(refused.code).toBe('pptxUnsupported');
    expect(refused.error).toContain('PowerPoint');
    expect(refused.diagnostics[0].message).toBeTruthy();
    expect(refused.diagnostics[0].message).not.toBe(refused.diagnostics[0].code);
    const response = await app.request('/api/archive?file=api.pptx', { method: 'POST', body: await fixture('supported') });
    expect(response.status).toBe(200);
    const imported = await response.json();
    const source = await app.request(`/api/projects/${imported.name}/raw/${imported.pptx.source}`);
    expect(source.status).toBe(200);
    expect(source.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(await fixture('supported'));
    const tooLarge = await app.request('/api/archive?file=huge.zip', { method: 'POST', headers: { 'content-length': String(1024 ** 3 + 1) }, body: 'x' });
    expect(tooLarge.status).toBe(413);
    expect((await tooLarge.json()).code).toBe('archiveInputTooBig');
  });

  it('CLI uses the same converter and prints actionable JSON diagnostics', async () => {
    const exec = promisify(execFile);
    const cwd = fileURLToPath(new URL('../../..', import.meta.url));
    const cli = fileURLToPath(new URL('../../../apps/server/src/cli.ts', import.meta.url));
    const source = fileURLToPath(new URL('./fixtures/pptx-smoke/portrait.pptx', import.meta.url));
    const env = { ...process.env, DC_PROJECTS: root, DC_LANG: 'en' };
    const { stdout } = await exec(process.execPath, ['--import', 'tsx', cli, 'import', source, '--json'], { cwd, env });
    const got = JSON.parse(stdout);
    expect(got.pptx.report).toMatch(/^uploads\//);
    expect(got.dir).toBe(join(root, got.name));
    const unsupported = fileURLToPath(new URL('./fixtures/pptx-smoke/cases/table.pptx', import.meta.url));
    await expect(exec(process.execPath, ['--import', 'tsx', cli, 'import', unsupported, '--json'], { cwd, env })).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('pptxUnsupported') });
  });

  it('returns a PPTX-specific repair action for an invalid .pptx', async () => {
    await expect(archive.unpackProject(strToU8('not a zip'), 'broken.pptx')).rejects.toMatchObject({ key: 'pptxInvalid', diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'invalid_zip' })]) });
  });
});
