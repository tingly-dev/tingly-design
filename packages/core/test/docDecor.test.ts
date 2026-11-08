import { describe, expect, it } from 'vitest';
import { DOC_ELEMENTS, DOC_TAG, consumingGuide, docDecorCss, docLookCss, docLookFromSystem, docRoleReport, markdownToWechat, parseDocDecls, resolveDocDecls, resolveTokens, wechatStyles } from '../src';

const tokens = (doc: unknown, extra: object = {}) =>
  resolveTokens({
    color: {
      themes: [{ id: 'light', name: 'Light' }, { id: 'dark', name: 'Dark' }],
      tokens: [
        { name: 'surface', value: { light: '#ffffff', dark: '#111111' } },
        { name: 'ink', value: { light: '#222222', dark: '#eeeeee' } },
        { name: 'accent', value: { light: '#07c160', dark: '#3ddc84' } },
        { name: 'line', value: { light: '#dddddd', dark: '#333333' } },
      ],
    },
    spacing: { tokens: [{ name: 'space-2', value: '12px' }] },
    doc,
    ...extra,
  });

const decor = {
  tokens: [
    { name: 'h1', value: 'border-left: 6px solid {accent}; padding-left: {space-2}' },
    { name: 'img', value: 'background-color: #ffffff; padding: 10px 10px 36px; border: 1px solid {line}' },
  ],
};

describe('parseDocDecls', () => {
  it('keeps the declarations a document keeps, in order, written one way', () => {
    expect(parseDocDecls('Border-Left : 6px solid {accent} ;padding-left:12px;').css).toBe('border-left:6px solid {accent};padding-left:12px');
  });

  it('refuses what the platform drops, a picture by address, var(), !important and a property it does not know, with a reason each', () => {
    const r = parseDocDecls('box-shadow: 0 0 4px #000; position: absolute; background: url(a.png); color: var(--x); margin: 0 !important; display: flex; padding: 4px');
    expect(r.css).toBe('padding:4px');
    expect(r.dropped).toHaveLength(6);
  });
});

describe('resolveDocDecls', () => {
  it('fills the names in and leaves out a declaration whose name is not known', () => {
    const resolve = (n: string) => ({ accent: '#07c160' })[n as 'accent'];
    expect(resolveDocDecls('border-left:6px solid {accent};color:{nope}', resolve)).toBe('border-left:6px solid #07c160');
  });
});

describe('the doc family of tokens.json', () => {
  it('is read into docStyles and is not a token anyone reads as a value', () => {
    const t = tokens(decor);
    expect(t.issues).toEqual([]);
    expect(t.docStyles.map((d) => d.element)).toEqual(['h1', 'img']);
    expect(t.others.some((f) => f.key === 'doc')).toBe(false);
  });

  it('says why an element, a property or a name cannot be read, and keeps the rest', () => {
    const t = tokens({ tokens: [{ name: 'h7', value: 'color: red' }, { name: 'h2', value: 'color:{ghost}' }, { name: 'h3', value: 'position: fixed; padding: 2px' }, { name: 'h1', value: 'padding: 1px' }] });
    expect(t.docStyles.map((d) => `${d.element}:${d.css}`)).toEqual(['h3:padding:2px', 'h1:padding:1px']);
    expect(t.issues.map((i) => i.message).join('\n')).toMatch(/h7.*not an element[\s\S]*ghost[\s\S]*position/);
  });

  it('is empty for a system without one', () => {
    expect(tokens(undefined).docStyles).toEqual([]);
  });
});

describe('what a system adds to an element reaches every output the same', () => {
  const t = tokens(decor);
  const light = docLookFromSystem(t, 'light');
  const dark = docLookFromSystem(t, 'dark');

  it('follows the theme: the bar is the theme’s accent, and the length is the system’s', () => {
    expect(light.decor.h1).toBe('border-left:6px solid #07c160;padding-left:12px');
    expect(dark.decor.h1).toBe('border-left:6px solid #3ddc84;padding-left:12px');
    expect(light.decor.img).toContain('border:1px solid #dddddd');
  });

  it('is the export stylesheet’s last rules, and the editor page’s rules under its scope', () => {
    expect(docLookCss(light)).toContain('h1{border-left:6px solid #07c160;padding-left:12px}');
    expect(docDecorCss(light, '.docbody')).toContain('.docbody img{background-color:#ffffff;padding:10px 10px 36px;border:1px solid #dddddd}');
    expect(docDecorCss(docLookFromSystem(tokens(undefined), 'light'), '.x')).toBe('');
  });

  it('is written inline on the WeChat article after the look’s own values, so it wins, and nothing the platform drops', () => {
    expect(wechatStyles(light).h1).toMatch(/margin:[^;]*;padding:0;[^"]*border-left:6px solid #07c160;padding-left:12px;$/);
    const html = markdownToWechat('# T\n\n![a](data:image/png;base64,AAAA)\n', { look: light }).html;
    expect(html).toMatch(/<h1 style="[^"]*border-left:6px solid #07c160/);
    expect(html).toMatch(/<img [^>]*style="[^"]*padding:10px 10px 36px/);
    expect(html).not.toMatch(/box-shadow|position:|var\(|<style/);
  });

  it('is listed in the role report as given, and not when the system says nothing', () => {
    const lines = docRoleReport(t, 'light', light).filter((l) => l.role.kind === 'style');
    expect(lines.map((l) => l.role.name)).toEqual(['h1', 'img']);
    expect(lines.every((l) => l.source === 'system')).toBe(true);
    expect(docRoleReport(tokens(undefined), 'light').some((l) => l.role.kind === 'style')).toBe(false);
  });

  it('has a tag for every element it names', () => {
    for (const e of DOC_ELEMENTS) expect(DOC_TAG[e]).toMatch(/^[a-z0-9]+$/);
  });
});

describe('the README appendix', () => {
  it('lists what a document adds to its elements, so an agent reading it knows', () => {
    expect(consumingGuide(tokens(decor))).toMatch(/### Document decorations[\s\S]*`h1`[\s\S]*border-left:6px solid \{accent\}/);
    expect(consumingGuide(tokens(undefined))).not.toContain('Document decorations');
  });
});
