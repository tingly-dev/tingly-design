import { describe, expect, it } from 'vitest';
import { DOC_COLORS, figureKey, markdownToWechat, wechatFigures, wechatStyles } from '../src';

const SAMPLE = [
  '# Title',
  '',
  '## Section',
  '',
  'Text with **bold**, *italic*, ~~gone~~, `code`, ==x== and <mark>marked</mark> and <span data-color="red">red</span>.',
  '',
  'A [site](https://example.com/a) and again [site](https://example.com/a), [post](https://mp.weixin.qq.com/s/abc), bare <https://example.org>.',
  '',
  '> quote',
  '',
  '- one',
  '  - nested',
  '- [x] done',
  '',
  '1. first',
  '2. second',
  '',
  '```ts',
  'const a = 1 < 2;',
  '  indented();',
  '```',
  '',
  '| a | b |',
  '| :-- | --: |',
  '| 1 | 2 |',
  '',
  '```csv',
  'x,y',
  '1,2',
  '```',
  '',
  '![pic](assets/a%20b.png)',
  '',
  '![far](https://cdn.example.com/p.png)',
  '',
  '---',
].join('\n');

const picture = { src: 'data:image/png;base64,AAAA', width: 100, height: 50 };

describe('markdownToWechat', () => {
  const r = markdownToWechat(SAMPLE, { colors: DOC_COLORS, images: new Map([['assets/a b.png', picture]]) }, 'Links');

  it('writes only what the editor keeps: no sheet, class, id, variable or script', () => {
    expect(r.html).not.toMatch(/<style|<link|<script|\sclass=|\sid=|var\(/i);
    expect(r.html).not.toMatch(/position:|float:|display:\s*(flex|grid)|transform:|box-shadow|animation/i);
  });

  it('gives every block tag a style of its own', () => {
    const tags = r.html.match(/<(h[1-6]|p|ul|ol|li|blockquote|table|th|td|hr|section|pre|code|img)\b[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThan(20);
    for (const tag of tags) expect(tag).toMatch(/style="/);
  });

  it('balances the tags it opens', () => {
    for (const tag of ['p', 'ul', 'ol', 'li', 'table', 'tr', 'blockquote', 'section', 'pre', 'code', 'strong', 'em', 'h1', 'h2']) {
      const open = r.html.match(new RegExp(`<${tag}[\\s>]`, 'g'))?.length ?? 0;
      const close = r.html.match(new RegExp(`</${tag}>`, 'g'))?.length ?? 0;
      expect(close, tag).toBe(open);
    }
  });

  it('numbers an outside address once and lists it at the end', () => {
    expect(r.links).toEqual([{ n: 1, text: 'site', url: 'https://example.com/a' }]);
    expect(r.html).toContain('[1]</sup>');
    expect(r.html).toContain('>Links</p>');
    expect(r.html).toContain('[1] site: https://example.com/a');
    expect(r.issues[0]).toEqual({ kind: 'links', count: 1 });
  });

  it('keeps a link to a platform article, and an address that is its own words', () => {
    expect(r.html).toContain('<a href="https://mp.weixin.qq.com/s/abc"');
    expect(r.html).not.toContain('example.org</a>');
    expect(r.links.some((l) => l.url.includes('example.org'))).toBe(false);
  });

  it('colours the named span and marks the highlight', () => {
    expect(r.html).toContain(`color:${DOC_COLORS.red};`);
    expect(r.html).toMatch(/background-color:#fff3a3;[^>]*>marked</);
  });

  it('puts the picture in by its decoded path and flags a remote one', () => {
    expect(r.html).toContain('src="data:image/png;base64,AAAA"');
    expect(r.html).toContain('width:100px;');
    expect(r.issues).toContainEqual({ kind: 'picture-remote', url: 'https://cdn.example.com/p.png' });
  });

  it('draws a csv fence as a table and escapes code', () => {
    expect(r.html).toContain('<th style');
    expect(r.html).toContain('const a = 1 &lt; 2;');
    expect(r.html).toContain('&nbsp;&nbsp;indented();');
  });

  it('leaves a picture it could not read as its description, once', () => {
    const m = markdownToWechat('![a](assets/x.png)\n\n![b](assets/x.png)');
    expect(m.issues).toEqual([{ kind: 'picture-missing', path: 'assets/x.png' }]);
    expect(m.html).toContain('[a]');
  });

  it('plain text carries the words, one block to a line', () => {
    expect(r.text).toContain('Title\n');
    expect(r.text).not.toMatch(/<\/?[a-z]/);
  });

  it('follows the doc look for the fonts', () => {
    expect(wechatStyles({ bodyFont: 'serif' }).p).toContain('Songti');
    expect(wechatStyles().p).toContain('PingFang');
  });
});

describe('wechatFigures', () => {
  const md = '```mermaid\ngraph TD\nA-->B\n```\n\n```latex\nx^2\n```\n\n```mermaid\ngraph TD\nA-->B\n```\n\n- ```tex\n  y\n  ```\n';
  it('lists each drawn fence once, in order', () => {
    expect(wechatFigures(md).map((f) => [f.lang, f.kind])).toEqual([
      ['mermaid', 'diagram'],
      ['latex', 'math'],
      ['tex', 'math'],
    ]);
  });

  it('places the picture the editor drew, or says it is missing', () => {
    const src = 'graph TD\nA-->B';
    const got = markdownToWechat('```mermaid\n' + src + '\n```', { figures: new Map([[figureKey('mermaid', src), picture]]) });
    expect(got.html).toContain('<img');
    expect(markdownToWechat('```mermaid\n' + src + '\n```').issues).toEqual([{ kind: 'figure-missing', lang: 'mermaid' }]);
  });
});
