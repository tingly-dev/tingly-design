import { describe, expect, it } from 'vitest';
import { parseConversation, resumeLost, sessionFor } from '../src';

const A = '11111111-2222-3333-4444-555555555555';
const B = '66666666-7777-8888-9999-000000000000';
const kept = { session: A, prompt: 'make it blue', at: 1 };

describe('sessionFor', () => {
  it('continues the project conversation by default', () => expect(sessionFor({}, kept)).toBe(A));
  it('starts fresh when asked', () => expect(sessionFor({ fresh: true }, kept)).toBeUndefined());
  it('prefers an explicit session', () => expect(sessionFor({ resume: B, fresh: true }, kept)).toBe(B));
  it('ignores a session that is not an id', () => expect(sessionFor({ resume: '--evil' }, kept)).toBe(A));
  it('has nothing to continue in a new project', () => expect(sessionFor({}, null)).toBeUndefined());
});

describe('parseConversation', () => {
  it('reads a kept conversation', () => expect(parseConversation(JSON.stringify(kept))).toEqual(kept));
  it('drops a damaged file', () => {
    expect(parseConversation('{')).toBeNull();
    expect(parseConversation('{"session":"x"}')).toBeNull();
  });
});

describe('resumeLost', () => {
  it('spots a session Claude Code no longer has', () => {
    expect(resumeLost('No conversation found with session ID: abc')).toBe(true);
    expect(resumeLost('rate limited')).toBe(false);
  });
});
