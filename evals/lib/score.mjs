// Scores what an agent left behind, as a person would: through Tingly Design's own command line, never by
// reading its source. `td(args)` runs the command line against the projects folder and returns { code, out }.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const TEXT = /\.(html|md|json|css|txt)$/i;

async function walk(dir, skip = (name) => name === 'renders' || name.startsWith('.')) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (skip(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, skip)));
    else out.push(p);
  }
  return out;
}

/** Which of the words are missing from the project's text files (case-insensitive). */
export async function missingWords(dir, words) {
  const text = (await Promise.all((await walk(dir)).filter((f) => TEXT.test(f)).map((f) => readFile(f, 'utf8').catch(() => '')))).join('\n').toLowerCase();
  return words.filter((w) => !text.includes(w.toLowerCase()));
}

/** The pictures the task asked to export: files under renders/ (not renders/check) newer than `since`. */
export async function exportedFiles(dir, ext, since) {
  const all = await walk(join(dir, 'renders'), (name) => name === 'check');
  const out = [];
  for (const f of all.filter((x) => x.toLowerCase().endsWith(`.${ext}`))) {
    const s = await stat(f).catch(() => null);
    if (s && s.size > 0 && s.mtimeMs >= since) out.push(f);
  }
  return out;
}

/** The outline's items counted by type. */
export function countItems(outline) {
  const n = {};
  for (const i of outline?.items ?? []) n[i.type] = (n[i.type] ?? 0) + 1;
  return n;
}

const json = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * The checks of one run. `task.expect` (counts of items by type), `task.mustContain` (words the work must
 * hold) and `task.export` ({ as }) say what the brief asked for. A run passes when the project exists, has
 * no errors, draws without errors, holds what was asked for and exported what was asked for; warnings are
 * counted and listed, not failed.
 */
export async function score(task, { dir, td, since }) {
  const r = { project: task.project, checks: [], warnings: [], pass: false, final: null };
  const add = (name, ok, detail = '') => r.checks.push({ name, ok, detail });

  const listed = await td(['list', dir, '--json']);
  const outline = listed.code === 0 ? json(listed.out) : null;
  add('project exists', !!outline, outline ? '' : listed.out.trim().slice(0, 200));
  if (!outline) return finish(r);

  for (const [type, want] of Object.entries(task.expect ?? {})) {
    const have = countItems(outline)[type] ?? 0;
    add(`${type} count`, typeof want === 'number' ? have === want : have >= want.min, `${have}`);
  }

  const missing = await missingWords(dir, task.mustContain ?? []);
  add('holds what the brief named', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '');

  const looked = await td(['check', dir, '--snapshots', '--json']);
  const result = json(looked.out);
  const problems = result?.problems ?? [];
  add('check finds no errors', problems.every((p) => p.level !== 'error'), problems.filter((p) => p.level === 'error').map((p) => `${p.file} ${p.code}`).join('; '));
  r.warnings = problems.filter((p) => p.level === 'warning').map((p) => ({ file: p.file, code: p.code, rule: p.rule }));
  r.pictures = result?.snapshots ?? [];
  add('drawn', (result?.snapshots?.length ?? 0) > 0, `${result?.snapshots?.length ?? 0} pictures`);

  if (task.export) {
    const files = await exportedFiles(dir, task.export.as, since);
    add(`exported ${task.export.as}`, files.length > 0, files.length ? files.map((f) => f.split('/').pop()).join(', ') : 'nothing new under renders/');
    r.finals = files.sort();
    r.final = r.finals[0] ?? null;
  }
  r.finals ??= r.pictures ?? [];
  r.final ??= r.pictures?.[0] ?? null;
  return finish(r);

  function finish(x) {
    x.pass = x.checks.every((c) => c.ok);
    return x;
  }
}
