import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOC_COLORS, figureKey, markdownToWechat, WECHAT_LOOKS, wechatFigures, wechatStyles } from '../src';

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
    expect(r.html).not.toMatch(/<style|<link|<script|\sid=|var\(/i);
    // the only classes are the platform's own code-block ones, which the editor knows
    expect([...r.html.matchAll(/\sclass="([^"]*)"/g)].every((m) => /^(code-snippet|ProseMirror-trailingBreak)/.test(m[1]))).toBe(true);
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
    expect(r.html).toMatch(/background-color:#ffeeb2;[^>]*>marked</);
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
    expect(r.html).toContain('<pre class="code-snippet__js code-snippet code-snippet_nowrap" data-lang="ts"');
    expect(r.html).toContain('<span leaf="">');
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

describe('looks: what you see is what you get', () => {
  const sample = markdownToWechat('# T\n\n## H\n\n> q\n\n| a |\n| - |\n| b |\n\n[x](https://example.com)\n');

  it('the default draws the doc as the doc draws itself: no decoration the doc does not show', () => {
    expect(sample.html).not.toContain('#07c160');
    expect(sample.html).not.toMatch(/border-left:4px/);
    expect(wechatStyles().h2).not.toContain('border-left');
    expect(wechatStyles().blockquote).toContain('border-left:3px solid #d6d4ce');
    expect(wechatStyles().blockquote).toContain('background-color:transparent');
  });

  it('a look with its own language is chosen, never added silently', () => {
    expect(wechatStyles({ look: 'wechat' }).h2).toContain('border-left:4px solid #07c160');
    expect(markdownToWechat('## H', { look: 'wechat' }).html).toContain('#07c160');
    expect(WECHAT_LOOKS).toEqual(['doc', 'wechat']);
  });
});

describe('the fixture with every element', () => {
  const md = readFileSync(new URL('./fixtures/wechat-all.md', import.meta.url), 'utf8');
  const pic = { src: 'data:image/png;base64,AAAA', width: 200, height: 100 };
  const fig = (lang: string) => wechatFigures(md).find((f) => f.lang === lang)!;
  const figures = new Map(['mermaid', 'latex'].map((l) => [fig(l).key, pic]));
  for (const look of WECHAT_LOOKS) {
    const r = markdownToWechat(md, { look, colors: DOC_COLORS, images: new Map([['assets/wechat-sample.png', pic]]), figures }, 'Links');

    it(`${look}: every element is there, and only inline styles`, () => {
      for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'em', 'blockquote', 'ul', 'ol', 'li', 'hr', 'table', 'th', 'td', 'pre', 'code', 'img', 'sup', 'a', 'br']) {
        expect(r.html, tag).toContain(`<${tag}`);
      }
      expect(r.html).not.toMatch(/<style|<link|<script|\sid=|var\(|<div/i);
      expect([...r.html.matchAll(/\sclass="([^"]*)"/g)].every((m) => /^(code-snippet|ProseMirror-trailingBreak)/.test(m[1]))).toBe(true);
      // nested lists stay lists, the second quote level is a quote
      expect(r.html.match(/<ul /g)!.length).toBeGreaterThanOrEqual(4);
      expect(r.html.match(/<blockquote /g)!.length).toBe(2);
      expect(r.html).toContain('start="3"');
      expect(r.html).toContain('text-align:center');
      expect(r.html).toContain('text-align:right');
    });

    it(`${look}: links, pictures and drawn blocks`, () => {
      expect(r.links.map((l) => l.url)).toEqual(['https://example.com/in-quote', 'https://github.com/tingly-dev/tingly-design', 'https://example.com/a?b=1&c=2', 'mailto:hi@example.com']);
      expect(r.html).toContain('<a href="https://mp.weixin.qq.com/s/abcdef"');
      expect(r.html.match(/<img /g)!.length).toBe(4); // the local one, the remote one, the diagram, the formula
      expect(r.html).toContain('<th style');
      expect(r.issues.map((i) => i.kind).sort()).toEqual(['html-dropped', 'links', 'picture-remote']);
    });
  }
});
