import { describe, expect, it } from 'vitest';
import { describeTool, elapsedLabel } from '../src/activity';

const root = '/repo';
const project = '/repo/projects/deck';

describe('describeTool', () => {
  it('names the format reference instead of its path', () => {
    expect(describeTool('Read', { file_path: '/repo/.claude/skills/slides/SKILL.md' }, root, project)).toEqual({ kind: 'read', text: '读格式说明' });
  });
  it('shows project files relative to the project', () => {
    expect(describeTool('Read', { file_path: '/repo/projects/deck/deck.json' }, root, project).text).toBe('读 deck.json');
    expect(describeTool('Read', { file_path: 'projects/deck/slides/a.html' }, root, project).text).toBe('读 slides/a.html');
  });
  it('marks edits and writes inside the project as changed files', () => {
    expect(describeTool('Edit', { file_path: '/repo/projects/deck/slides/a.html' }, root, project)).toEqual({ kind: 'edit', text: '改 slides/a.html', changed: 'slides/a.html' });
    expect(describeTool('Write', { file_path: '/repo/projects/deck/slides/b.html' }, root, project).changed).toBe('slides/b.html');
    expect(describeTool('Edit', { file_path: '/elsewhere/x.txt' }, root, project).changed).toBeUndefined();
  });
  it('words searches and commands', () => {
    expect(describeTool('Grep', { pattern: 'title' }, root, project).text).toBe('搜索“title”');
    expect(describeTool('Glob', { pattern: '**/*.html' }, root, project).text).toBe('找文件 **/*.html');
    expect(describeTool('Bash', { command: 'node scripts/dash-query.mjs projects/x/data/a.db "select 1"' }, root, project).text).toBe('查询数据');
    expect(describeTool('Mystery', {}, root, project)).toEqual({ kind: 'other', text: 'Mystery' });
  });
});

describe('elapsedLabel', () => {
  it('counts seconds, then minutes', () => {
    expect(elapsedLabel(400)).toBe('0 秒');
    expect(elapsedLabel(12_300)).toBe('12 秒');
    expect(elapsedLabel(65_000)).toBe('1 分 05 秒');
  });
});
