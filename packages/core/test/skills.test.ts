import { describe, expect, it } from 'vitest';
import { KIND_SKILL, chosenSkills, isSkillId, type SkillInfo } from '../src';

const skill = (id: string, scope: SkillInfo['scope'] = 'builtin'): SkillInfo => ({ id, name: id, description: `${id} format`, scope, path: `.claude/skills/${id}/SKILL.md` });

describe('isSkillId', () => {
  it('is a folder name, never a path', () => {
    expect(isSkillId('issue-resolve')).toBe(true);
    expect(isSkillId('dc-canvas')).toBe(true);
    expect(isSkillId('../etc/passwd')).toBe(false);
    expect(isSkillId('a/b')).toBe(false);
    expect(isSkillId('')).toBe(false);
    expect(isSkillId(3)).toBe(false);
  });
});

describe('chosenSkills', () => {
  const all = [skill('dc-canvas'), skill('issue-resolve'), skill('mine', 'project')];
  it('resolves the names a request carries, in its order', () => expect(chosenSkills(all, ['mine', 'issue-resolve']).map((s) => s.id)).toEqual(['mine', 'issue-resolve']));
  it('drops names no skill has, duplicates and anything that is not a name', () => expect(chosenSkills(all, ['mine', 'nope', 'mine', '../x', 4]).map((s) => s.id)).toEqual(['mine']));
  it('reads no list as no skills', () => expect(chosenSkills(all, undefined)).toEqual([]));
});

describe('KIND_SKILL', () => {
  it('names the format reference each kind already reads', () => expect(KIND_SKILL.design).toBe('dc-canvas'));
});