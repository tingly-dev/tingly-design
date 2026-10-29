import { describe, expect, it } from 'vitest';
import { TINGLY_BOX_IMAGEGEN, boxClaudeUrl, migrateSaved, resolveAi, sanitizeSaved, validBaseUrl, TINGLY_BOX_ANTHROPIC } from '../src/aiConfig';

describe('resolveAi fast AI', () => {
  it('defaults to Anthropic with the small model and no key', () => {
    const r = resolveAi({}, {}).fast;
    expect(r.preset).toBe('anthropic');
    expect(r.model).toEqual({ value: 'claude-haiku-5-5', source: 'default' });
    expect(r.key).toEqual({ set: false, source: 'none' });
    expect(r.ready).toBe(false);
  });
  it('knows Tingly Box by its URL and defaults to its alias', () => {
    const r = resolveAi({}, { fastBaseUrl: TINGLY_BOX_ANTHROPIC + '/', fastKey: 'k' }).fast;
    expect(r.preset).toBe('tingly-box');
    expect(r.baseUrl.value).toBe(TINGLY_BOX_ANTHROPIC);
    expect(r.model.value).toBe('tingly');
    expect(r.ready).toBe(true);
  });
  it('lets the environment win over what was saved, field by field', () => {
    const r = resolveAi({ baseUrl: 'https://gw.example', key: 'e', fastModel: 'm1' }, { fastBaseUrl: TINGLY_BOX_ANTHROPIC, fastKey: 's', fastModel: 'm2' }).fast;
    expect(r.baseUrl).toEqual({ value: 'https://gw.example', source: 'env' });
    expect(r.preset).toBe('custom');
    expect(r.key.source).toBe('env');
    expect(r.model).toEqual({ value: 'm1', source: 'env' });
  });
});

describe('resolveAi Claude Code', () => {
  it('uses its own sign-in until a tab is chosen, and needs nothing for it', () => {
    const c = resolveAi({}, { fastKey: 'k' }).claude;
    expect(c.mode).toEqual({ value: 'local', source: 'default' });
    expect(c.launchUrl).toBe('');
    expect(c.ready).toBe(true);
    expect(c.model.value).toBe('');
  });
  it('goes through Box’s Claude Code routing, with its own token, model and profile', () => {
    const c = resolveAi({}, { claudeMode: 'box', claudeBoxKey: 'b', claudeProfile: 'p1' }).claude;
    expect(c.launchUrl).toBe('http://localhost:12580/tingly/claude_code:p1');
    expect(c.model).toEqual({ value: 'cc', source: 'default' });
    expect(c.ready).toBe(true);
    expect(resolveAi({}, { claudeMode: 'box' }).claude.ready).toBe(false);
    expect(boxClaudeUrl('http://box.lan:9/tingly/anthropic', 'work')).toBe('http://box.lan:9/tingly/claude_code:work');
  });
  it('keeps a profile name that cannot be a URL token out of the address', () => {
    expect(resolveAi({}, { claudeMode: 'box', claudeProfile: 'a/b' }).claude.launchUrl).toBe('http://localhost:12580/tingly/claude_code');
    expect(sanitizeSaved({ claudeProfile: 'a b' }).claudeProfile).toBeUndefined();
  });
  it('takes any address in the custom tab, Anthropic’s own when empty', () => {
    const c = resolveAi({}, { claudeMode: 'custom', claudeBaseUrl: 'https://gw.example/', claudeKey: 'k', claudeModel: 'm' }).claude;
    expect(c.launchUrl).toBe('https://gw.example');
    expect(c.model).toEqual({ value: 'm', source: 'saved' });
    expect(resolveAi({}, { claudeMode: 'custom', claudeKey: 'k' }).claude.launchUrl).toBe('');
  });
  it('keeps each tab’s values apart, whichever is shown', () => {
    const r = resolveAi({}, { claudeMode: 'custom', claudeBoxKey: 'b', claudeBoxModel: 'x', claudeKey: 'c', claudeModel: 'y' }).claude;
    expect(r.model.value).toBe('y');
    expect(r.box.model.value).toBe('x');
    expect(r.box.key.set).toBe(true);
  });
  it('treats an address the host fixed as the custom tab, left as the host set it', () => {
    const c = resolveAi({ baseUrl: TINGLY_BOX_ANTHROPIC, key: 'e' }, { claudeMode: 'local' }).claude;
    expect(c.mode).toEqual({ value: 'custom', source: 'env' });
    expect(c.launchUrl).toBe(TINGLY_BOX_ANTHROPIC);
    expect(c.model.value).toBe('tingly');
    expect(resolveAi({ key: 'e' }, {}).claude.mode).toEqual({ value: 'custom', source: 'default' });
  });
  it('passes the host’s model on to every tab', () => {
    expect(resolveAi({ claudeModel: 'h' }, {}).claude.model).toEqual({ value: 'h', source: 'env' });
    expect(resolveAi({ claudeModel: 'h' }, { claudeMode: 'box' }).claude.model.value).toBe('h');
  });
});

describe('resolveAi image generation', () => {
  it('is off until an address and a key are given: nothing follows another card', () => {
    const r = resolveAi({}, { fastKey: 'k', fastBaseUrl: TINGLY_BOX_ANTHROPIC, claudeBoxKey: 'b' }).image;
    expect(r.baseUrl.value).toBe('');
    expect(r.preset).toBeNull();
    expect(r.ready).toBe(false);
  });
  it('knows Tingly Box’s gateway and its alias', () => {
    const r = resolveAi({}, { imageBaseUrl: TINGLY_BOX_IMAGEGEN, imageKey: 'k' }).image;
    expect(r.preset).toBe('tingly-box');
    expect(r.model.value).toBe('tingly');
    expect(r.ready).toBe(true);
  });
  it('needs a key even with Tingly Box', () => {
    expect(resolveAi({}, { imageBaseUrl: TINGLY_BOX_IMAGEGEN }).image.ready).toBe(false);
  });
  it('takes any OpenAI-compatible address, with OpenAI’s model by default and its own key', () => {
    const r = resolveAi({}, { imageBaseUrl: 'https://api.openai.com/v1/', imageKey: 'sk' }).image;
    expect(r.preset).toBe('custom');
    expect(r.baseUrl).toEqual({ value: 'https://api.openai.com/v1', source: 'saved' });
    expect(r.model.value).toBe('gpt-image-1');
    expect(r.key).toEqual({ set: true, source: 'saved' });
    expect(r.ready).toBe(true);
  });
  it('is on by default; the saved switch or the host can turn it off without losing the settings', () => {
    const base = { imageBaseUrl: TINGLY_BOX_IMAGEGEN, imageKey: 'k' };
    expect(resolveAi({}, base).image).toMatchObject({ ready: true, active: true, enabled: { value: true, source: 'default' } });
    expect(resolveAi({}, { ...base, imageEnabled: false }).image).toMatchObject({ ready: true, active: false, enabled: { value: false, source: 'saved' } });
    expect(resolveAi({ imageEnabled: '0' }, base).image.enabled).toEqual({ value: false, source: 'env' });
    expect(resolveAi({ imageEnabled: '1' }, { ...base, imageEnabled: false }).image.enabled.value).toBe(false);
  });
  it('keeps a host-fixed Tingly Box gateway working: Box’s image address with the host’s token', () => {
    const r = resolveAi({ baseUrl: TINGLY_BOX_ANTHROPIC, key: 'host' }, {}).image;
    expect(r).toMatchObject({ preset: 'tingly-box', ready: true, active: true, key: { set: true, source: 'env' } });
    expect(resolveAi({ baseUrl: 'https://gw.example', key: 'host' }, {}).image.ready).toBe(false);
  });
  it('lets DC_IMAGE_* from the host win, field by field', () => {
    const r = resolveAi({ imageBaseUrl: 'https://img.example/v1', imageModel: 'm' }, { imageBaseUrl: TINGLY_BOX_IMAGEGEN, imageKey: 'k', imageModel: 'x' }).image;
    expect(r.baseUrl.source).toBe('env');
    expect(r.model).toEqual({ value: 'm', source: 'env' });
    expect(r.key.source).toBe('saved');
  });
});

describe('sanitizeSaved', () => {
  it('drops unknown fields and blanks', () => {
    expect(sanitizeSaved({ fastBaseUrl: ' http://x/ ', fastKey: '', fastModel: ' m ', evil: 1, claudeMode: 'nope' })).toEqual({ fastBaseUrl: 'http://x', fastModel: 'm' });
  });
  it('keeps the image fields, trimmed, and only an explicit off', () => {
    expect(sanitizeSaved({ imageBaseUrl: ' https://i/v1/ ', imageKey: ' k ', imageModel: ' m ' })).toEqual({ imageBaseUrl: 'https://i/v1', imageKey: 'k', imageModel: 'm' });
    expect(sanitizeSaved({ imageEnabled: false }).imageEnabled).toBe(false);
    expect('imageEnabled' in sanitizeSaved({ imageEnabled: true })).toBe(false);
  });
  it('validates base urls', () => {
    expect(validBaseUrl('')).toBe(true);
    expect(validBaseUrl('http://localhost:12580/x')).toBe(true);
    expect(validBaseUrl('file:///etc')).toBe(false);
    expect(validBaseUrl('nope')).toBe(false);
  });
});

describe('migrateSaved: a file from the shared-connection dialog', () => {
  it('reads a new file as it is', () => {
    const s = { fastKey: 'k', claudeMode: 'box' as const, claudeBoxKey: 'b' };
    expect(migrateSaved(s)).toEqual(s);
  });
  it('gives Box users three cards that work as before', () => {
    const s = migrateSaved({ baseUrl: TINGLY_BOX_ANTHROPIC, apiKey: 'k', fastModel: 'f', claudeModel: 'cc2', claudeProfile: 'p1', claudeRoute: 'shared' });
    expect(s).toMatchObject({ fastBaseUrl: TINGLY_BOX_ANTHROPIC, fastKey: 'k', fastModel: 'f', claudeMode: 'box', claudeBoxKey: 'k', claudeBoxModel: 'cc2', claudeProfile: 'p1', imageBaseUrl: TINGLY_BOX_IMAGEGEN, imageKey: 'k' });
    expect(s.claudeModel).toBeUndefined();
    const r = resolveAi({}, s);
    expect(r.fast).toMatchObject({ ready: true, preset: 'tingly-box' });
    expect(r.claude.launchUrl).toBe('http://localhost:12580/tingly/claude_code:p1');
    expect(r.image.active).toBe(true);
  });
  it('keeps Claude Code’s own sign-in when that was chosen, and an Anthropic key for fast AI', () => {
    const s = migrateSaved({ apiKey: 'sk', claudeRoute: 'login', claudeModel: 'm' });
    expect(s).toMatchObject({ fastKey: 'sk', claudeMode: 'local' });
    expect(s.imageKey).toBeUndefined();
  });
  it('turns a custom shared address into the custom tab, and lends the key to an image address on the same host only', () => {
    const s = migrateSaved({ baseUrl: 'https://gw.example', apiKey: 'k', claudeModel: 'm', imageBaseUrl: 'https://gw.example/v1' });
    expect(s).toMatchObject({ claudeMode: 'custom', claudeBaseUrl: 'https://gw.example', claudeKey: 'k', claudeModel: 'm', imageKey: 'k' });
    expect(migrateSaved({ baseUrl: 'https://gw.example', apiKey: 'k', imageBaseUrl: 'https://api.openai.com/v1' }).imageKey).toBeUndefined();
  });
  it('follows the old default: a key and no choice meant the shared connection', () => {
    expect(migrateSaved({ apiKey: 'k' }).claudeMode).toBe('custom');
    expect(migrateSaved({ baseUrl: 'https://gw.example' }).claudeMode).toBe('local');
  });
});
