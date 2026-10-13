import { describe, expect, it } from 'vitest';
import { describeTool, elapsed } from '../src/activity';

const root = '/repo';
const project = '/repo/projects/deck';

describe('describeTool', () => {
  it('names the format reference instead of its path', () => {
    expect(describeTool('Read', { file_path: '/repo/.claude/skills/slides/SKILL.md' }, root, project)).toEqual({ kind: 'read', op: 'readSkill' });
  });
  it('shows project files relative to the project', () => {
    expect(describeTool('Read', { file_path: '/repo/projects/deck/deck.json' }, root, project).target).toBe('deck.json');
    expect(describeTool('Read', { file_path: 'projects/deck/slides/a.html' }, root, project).target).toBe('slides/a.html');
  });
  it('marks edits and writes inside the project as changed files', () => {
    expect(describeTool('Edit', { file_path: '/repo/projects/deck/slides/a.html' }, root, project)).toEqual({ kind: 'edit', op: 'edit', target: 'slides/a.html', changed: 'slides/a.html' });
    expect(describeTool('Write', { file_path: '/repo/projects/deck/slides/b.html' }, root, project)).toMatchObject({ op: 'write', changed: 'slides/b.html' });
    expect(describeTool('Edit', { file_path: '/elsewhere/x.txt' }, root, project).changed).toBeUndefined();
  });
  it('tells searches and commands apart', () => {
    expect(describeTool('Grep', { pattern: 'title' }, root, project)).toEqual({ kind: 'search', op: 'grep', target: 'title' });
    expect(describeTool('Grep', { pattern: 'title', path: '/repo/projects/deck/slides' }, root, project)).toEqual({ kind: 'search', op: 'grepIn', target: 'title', within: 'slides' });
    expect(describeTool('Glob', { pattern: '**/*.html' }, root, project)).toEqual({ kind: 'search', op: 'glob', target: '**/*.html' });
    expect(describeTool('Bash', { command: 'node scripts/dash-query.mjs projects/x/data/a.db "select 1"' }, root, project)).toEqual({ kind: 'run', op: 'query' });
    expect(describeTool('Mystery', {}, root, project)).toEqual({ kind: 'other', op: 'tool', target: 'Mystery' });
  });
});

describe('elapsed', () => {
  it('splits into minutes and seconds', () => {
    expect(elapsed(400)).toEqual({ m: 0, s: 0 });
    expect(elapsed(12_300)).toEqual({ m: 0, s: 12 });
    expect(elapsed(65_000)).toEqual({ m: 1, s: 5 });
  });
});
