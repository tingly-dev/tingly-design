import { describe, expect, it } from 'vitest';
import { TINGLY_BOX_ANTHROPIC, TINGLY_BOX_IMAGEGEN, resolveAi, sanitizeSaved, validBaseUrl } from '../src/aiConfig';

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

describe('resolveAi image generation', () => {
  it('is off with Anthropic: there is no image endpoint to follow', () => {
    const r = resolveAi({}, { apiKey: 'k' });
    expect(r.image.baseUrl.value).toBe('');
    expect(r.image.ready).toBe(false);
  });
  it('follows Tingly Box: its gateway, its alias, the connection key', () => {
    const r = resolveAi({}, { baseUrl: TINGLY_BOX_ANTHROPIC, apiKey: 'k' });
    expect(r.image.baseUrl).toEqual({ value: TINGLY_BOX_IMAGEGEN, source: 'default' });
    expect(r.image.model.value).toBe('tingly');
    expect(r.image.key).toEqual({ set: true, source: 'connection' });
    expect(r.image.ready).toBe(true);
  });
  it('needs a key even with Tingly Box', () => {
    expect(resolveAi({}, { baseUrl: TINGLY_BOX_ANTHROPIC }).image.ready).toBe(false);
  });
  it('takes any OpenAI-compatible address, with OpenAI’s model by default and its own key', () => {
    const r = resolveAi({}, { imageBaseUrl: 'https://api.openai.com/v1/', imageKey: 'sk' });
    expect(r.image.baseUrl).toEqual({ value: 'https://api.openai.com/v1', source: 'saved' });
    expect(r.image.model.value).toBe('gpt-image-1');
    expect(r.image.key).toEqual({ set: true, source: 'saved' });
    expect(r.image.ready).toBe(true);
  });
  it('is on by default; the saved switch or the host can turn it off without losing the settings', () => {
    const base = { baseUrl: TINGLY_BOX_ANTHROPIC, apiKey: 'k' };
    expect(resolveAi({}, base).image).toMatchObject({ ready: true, active: true, enabled: { value: true, source: 'default' } });
    const off = resolveAi({}, { ...base, imageEnabled: false }).image;
    expect(off).toMatchObject({ ready: true, active: false, enabled: { value: false, source: 'saved' } });
    expect(resolveAi({ imageEnabled: '0' }, base).image.enabled).toEqual({ value: false, source: 'env' });
    expect(resolveAi({ imageEnabled: '1' }, { ...base, imageEnabled: false }).image.enabled.value).toBe(false);
    expect(resolveAi({}, { imageEnabled: false }).image.active).toBe(false);
  });
  it('keeps only an explicit off when saving', () => {
    expect(sanitizeSaved({ imageEnabled: false }).imageEnabled).toBe(false);
    expect('imageEnabled' in sanitizeSaved({ imageEnabled: true })).toBe(false);
  });
  it('lets DC_IMAGE_* from the host win, field by field', () => {
    const r = resolveAi({ imageBaseUrl: 'https://img.example/v1', imageModel: 'm' }, { baseUrl: TINGLY_BOX_ANTHROPIC, apiKey: 'k', imageModel: 'x' });
    expect(r.image.baseUrl.source).toBe('env');
    expect(r.image.model).toEqual({ value: 'm', source: 'env' });
    expect(r.image.key.source).toBe('connection');
  });
});

describe('sanitizeSaved', () => {
  it('drops unknown fields and blanks', () => {
    expect(sanitizeSaved({ baseUrl: ' http://x/ ', apiKey: '', fastModel: ' m ', evil: 1, claudeRoute: 'nope' })).toEqual({ baseUrl: 'http://x', fastModel: 'm' });
  });
  it('keeps the image fields, trimmed', () => {
    expect(sanitizeSaved({ imageBaseUrl: ' https://i/v1/ ', imageKey: ' k ', imageModel: ' m ' })).toEqual({ imageBaseUrl: 'https://i/v1', imageKey: 'k', imageModel: 'm' });
  });
  it('validates base urls', () => {
    expect(validBaseUrl('')).toBe(true);
    expect(validBaseUrl('http://localhost:12580/x')).toBe(true);
    expect(validBaseUrl('file:///etc')).toBe(false);
    expect(validBaseUrl('nope')).toBe(false);
  });
});
