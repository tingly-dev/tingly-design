import { describe, expect, it } from 'vitest';
import { TINGLY_BOX_ANTHROPIC, resolveAi, sanitizeSaved, validBaseUrl } from '../src/aiConfig';

describe('resolveAi', () => {
  it('defaults to Anthropic with the small model and no key', () => {
    const r = resolveAi({}, {});
    expect(r.preset).toBe('anthropic');
    expect(r.fastModel).toEqual({ value: 'claude-haiku-5-5', source: 'default' });
    expect(r.key).toEqual({ set: false, source: 'none' });
    expect(r.claudeRoute.value).toBe('login');
    expect(r.claudeModel.value).toBe('');
  });
  it('knows Tingly Box by its URL and defaults both models to its alias', () => {
    const r = resolveAi({}, { baseUrl: TINGLY_BOX_ANTHROPIC + '/', apiKey: 'k' });
    expect(r.preset).toBe('tingly-box');
    expect(r.baseUrl.value).toBe(TINGLY_BOX_ANTHROPIC);
    expect(r.fastModel.value).toBe('tingly');
    expect(r.claudeModel.value).toBe('tingly');
    expect(r.claudeRoute).toEqual({ value: 'shared', source: 'default' });
  });
  it('lets the environment win over what was saved, field by field', () => {
    const r = resolveAi({ baseUrl: 'https://gw.example', key: 'e', fastModel: 'm1' }, { baseUrl: TINGLY_BOX_ANTHROPIC, apiKey: 's', fastModel: 'm2', claudeModel: 'c' });
    expect(r.baseUrl).toEqual({ value: 'https://gw.example', source: 'env' });
    expect(r.preset).toBe('custom');
    expect(r.key.source).toBe('env');
    expect(r.fastModel).toEqual({ value: 'm1', source: 'env' });
    expect(r.claudeModel).toEqual({ value: 'c', source: 'saved' });
  });
  it('honours a saved choice of Claude Code sign-in even with a key', () => {
    expect(resolveAi({}, { apiKey: 'k', claudeRoute: 'login' }).claudeRoute.value).toBe('login');
  });
});

describe('sanitizeSaved', () => {
  it('drops unknown fields and blanks', () => {
    expect(sanitizeSaved({ baseUrl: ' http://x/ ', apiKey: '', fastModel: ' m ', evil: 1, claudeRoute: 'nope' })).toEqual({ baseUrl: 'http://x', fastModel: 'm' });
  });
  it('validates base urls', () => {
    expect(validBaseUrl('')).toBe(true);
    expect(validBaseUrl('http://localhost:12580/x')).toBe(true);
    expect(validBaseUrl('file:///etc')).toBe(false);
    expect(validBaseUrl('nope')).toBe(false);
  });
});
