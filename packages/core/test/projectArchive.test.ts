import { describe, expect, it } from 'vitest';
import { archiveKeeps, archivePath, freeName, installedSystems, kindOfFiles, planArchive, projectNameFrom, renameSystems, type ArchiveManifest } from '../src';

describe('archiveKeeps', () => {
  it('keeps the project files and leaves out what belongs to this machine', () => {
    const on = { journal: true };
    expect(archiveKeeps('canvas.json', on)).toBe(true);
    expect(archiveKeeps('uploads/a.png', on)).toBe(true);
    expect(archiveKeeps('ds/brand/fonts/x.woff2', on)).toBe(true);
    expect(archiveKeeps('.git/HEAD', on)).toBe(false);
    expect(archiveKeeps('renders/x-mp4.mp4', on)).toBe(false);
    expect(archiveKeeps('.runs.json', on)).toBe(false);
    expect(archiveKeeps('uploads/.DS_Store', on)).toBe(false);
    expect(archiveKeeps('node_modules/a/b.js', on)).toBe(false);
  });

  it('takes the change log only when asked', () => {
    expect(archiveKeeps('.journal.jsonl', { journal: true })).toBe(true);
    expect(archiveKeeps('.journal.jsonl', { journal: false })).toBe(false);
  });
});

describe('installedSystems', () => {
  it('reads the system names from the index', () => {
    const idx = JSON.stringify({ designSystems: [{ artifact: 'projects/brand' }, { artifact: 'projects/brand' }, { artifact: 'elsewhere/x' }, null, { artifact: 'projects/kit-2' }] });
    expect(installedSystems(idx)).toEqual(['brand', 'kit-2']);
    expect(installedSystems('not json')).toEqual([]);
    expect(installedSystems('{}')).toEqual([]);
  });

  it('points renamed systems at their new names', () => {
    const idx = JSON.stringify({ title: 'A', designSystems: [{ artifact: 'projects/brand', namespace: 'brand' }] });
    expect(JSON.parse(renameSystems(idx, { brand: 'brand-2' })).designSystems[0].artifact).toBe('projects/brand-2');
    expect(renameSystems(idx, {})).toBe(idx);
  });
});

describe('archive names', () => {
  it('refuses paths that leave the folder', () => {
    expect(archivePath('a/b.png')).toBe('a/b.png');
    expect(archivePath('./a//b.png')).toBe('a/b.png');
    expect(archivePath('a\\b.png')).toBe('a/b.png');
    expect(archivePath('../x')).toBeNull();
    expect(archivePath('a/../../x')).toBeNull();
    expect(archivePath('/etc/passwd')).toBeNull();
    expect(archivePath('C:/x')).toBeNull();
  });

  it('makes a project name out of a file name and finds a free one', () => {
    expect(projectNameFrom('My deck (final).zip')).toBe('My-deck-final');
    expect(projectNameFrom('设计.zip')).toBe('project');
    expect(freeName('deck', new Set())).toBe('deck');
    expect(freeName('deck', new Set(['deck', 'deck-2']))).toBe('deck-3');
  });
});

describe('planArchive', () => {
  it('follows the manifest', () => {
    const m: ArchiveManifest = { format: 1, project: 'pitch', kind: 'slides', systems: ['brand', 'missing'], journal: true, exportedAt: '' };
    const plan = planArchive(['tingly-design.json', 'pitch/deck.json', 'pitch/slides/a.html', 'brand/design-system.json', 'brand/tokens.json'], m);
    expect(plan).toEqual({ project: { prefix: 'pitch/', kind: 'slides', name: 'pitch' }, systems: [{ prefix: 'brand/', name: 'brand' }] });
  });

  it('takes a project zipped at its top, named after the file', () => {
    expect(planArchive(['motion.json', 'scenes/a.html'], null, 'promo')).toEqual({ project: { prefix: '', kind: 'motion', name: 'promo' }, systems: [] });
  });

  it('takes a folder zipped by hand, the project before its systems', () => {
    const plan = planArchive(['brand/design-system.json', 'site/canvas.json', 'site/A.dc.html', 'notes/readme.txt'], null);
    expect(plan?.project).toEqual({ prefix: 'site/', kind: 'design', name: 'site' });
    expect(plan?.systems).toEqual([{ prefix: 'brand/', name: 'brand' }]);
  });

  it('finds nothing in an archive with no project', () => {
    expect(planArchive(['a.txt', 'x/y.png'], null)).toBeNull();
    expect(kindOfFiles(['deck.json', 'canvas.json'])).toBe('slides');
  });
});
