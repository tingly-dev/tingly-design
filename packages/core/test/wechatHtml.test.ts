import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOC_COLORS, docLookFromSystem, docOwnLook, figureKey, lookOf, lookTokens, markdownToWechat, resolveTokens, wechatFigures, wechatStyles } from '../src';

// a built-in look as the look a doc wears when it has installed it and chosen its theme
const worn = (id: string) => {
  const l = lookOf(id)!;
  return docLookFromSystem(resolveTokens(lookTokens(l, id)), l.dark ? 'dark' : 'light');
};

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
  const r = markdownToWechat(SAMPLE, { images: new Map([['assets/a b.png', picture]]) }, 'Links');

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
    expect(wechatStyles(docOwnLook({ headingFont: 'sans', bodyFont: 'serif' })).p).toContain('Source Serif');
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
    expect(wechatStyles().root).not.toContain('background-color');
  });

  it('the WeChat look dresses its first-level heading and its pictures itself, inline, and the doc’s own look adds nothing', () => {
    const md = '# T\n\n![a](data:image/png;base64,AAAA)\n';
    const wx = markdownToWechat(md, { look: worn('wechat') }).html;
    expect(wx).toMatch(/<h1 style="[^"]*border-left:6px solid #07c160;padding-left:12px;/);
    expect(wx).toMatch(/<img [^>]*style="[^"]*box-sizing:border-box;[^"]*padding:10px 10px 36px/);
    expect(wx).not.toMatch(/box-shadow|position:|var\(/);
    expect(markdownToWechat(md).html).not.toContain('border-left:6px');
  });

  it('the text sizes and line height are the look’s: the WeChat system sets 16px at 1.8 and h1 24px, the doc’s own 1.75 and 30px', () => {
    const wx = wechatStyles(worn('wechat'));
    expect(wx.p).toContain('font-size:16px;line-height:1.8;');
    expect(wx.h1).toContain('font-size:24px');
    expect(wechatStyles().p).toContain('line-height:1.75;');
    expect(wechatStyles().h1).toContain('font-size:30px');
  });

  it('a design system the doc wears is what the article follows: the WeChat look is green only because the doc wears it', () => {
    const html = markdownToWechat('## H\n\n> q\n\n[x](https://mp.weixin.qq.com/s/a)', { look: worn('wechat') }).html;
    expect(html).toContain('color:#07c160');
    expect(html).toContain('border-left:3px solid #07c160');
    // its page is carried with the article, so it reads the same wherever it lands
    expect(wechatStyles(worn('wechat')).root).toContain('background-color:#ffffff');
  });

  it('a dark system carries its page and the text colours made for it', () => {
    const look = worn('nord');
    const root = wechatStyles(look).root;
    expect(root).toContain(`background-color:${look.page}`);
    const html = markdownToWechat('a <span data-color="red">r</span>', { look }).html;
    expect(html).toContain('color:#ff8a80');
    expect(html).not.toContain(`color:${DOC_COLORS.red}`);
  });
});

// the sample project holds the doc with every element: one source for this test, the end-to-end suite and the person's eyes
describe('the sample doc with every element', () => {
  const md = readFileSync(new URL('../../../projects/tingly-design-wechat-doc/tabs/all-elements.md', import.meta.url), 'utf8').replace('](../uploads/', '](uploads/');
  const pic = { src: 'data:image/png;base64,AAAA', width: 200, height: 100 };
  const fig = (lang: string) => wechatFigures(md).find((f) => f.lang === lang)!;
  const figures = new Map(['mermaid', 'latex'].map((l) => [fig(l).key, pic]));
  for (const [name, look] of [['own look', docOwnLook()], ['WeChat', worn('wechat')], ['Nord (dark)', worn('nord')]] as const) {
    const r = markdownToWechat(md, { look, images: new Map([['uploads/wechat-sample.png', pic]]), figures }, 'Links');

    it(`${name}: every element is there, and only inline styles`, () => {
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

    it(`${name}: links, pictures and drawn blocks`, () => {
      expect(r.links.map((l) => l.url)).toEqual(['https://example.com/in-quote', 'https://github.com/tingly-dev/tingly-design', 'https://example.com/a?b=1&c=2', 'mailto:hi@example.com']);
      expect(r.html).toContain('<a href="https://mp.weixin.qq.com/s/abcdef"');
      expect(r.html.match(/<img /g)!.length).toBe(4); // the local one, the remote one, the diagram, the formula
      expect(r.html).toContain('<th style');
      expect(r.issues.map((i) => i.kind).sort()).toEqual(['html-dropped', 'links', 'picture-remote']);
    });
  }
});
