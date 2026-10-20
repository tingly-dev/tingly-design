import { describe, expect, it } from 'vitest';
import { docToMarkdown, markdownToTab } from '../src';

const index = (title: string, tabs: object[]) => JSON.stringify({ title, tabs });
const files = (m: Record<string, string>) => (id: string) => m[id];

describe('docToMarkdown', () => {
  const doc = index('Guide', [{ id: 'a', title: 'Intro' }, { id: 'b', title: 'Setup', parent: 'a' }, { id: 'c', title: 'FAQ' }]);
  const tabs = files({
    a: '# Intro\n\nHello ==world==.\n\n## Why\n\nBecause `==x==`.\n',
    b: '## Install\n\n![shot](../assets/a%20b.png)\n\n<img src="../uploads/x.jpg" alt="">\n',
    c: '# Questions\n\n```md\n# not a heading\n![x](../assets/no.png)\n```\n',
  });

  it('puts the doc title first and each tab under it, subtabs one deeper', () => {
    const { markdown } = docToMarkdown(doc, tabs);
    expect(markdown.split('\n').filter((l) => /^#{1,6} /.test(l) && !l.startsWith('# not'))).toEqual(['# Guide', '## Intro', '### Why', '### Setup', '#### Install', '## Questions']);
  });

  it('uses the index title for a tab with no heading of its own', () => {
    expect(docToMarkdown(doc, tabs).markdown).toContain('### Setup\n\n#### Install');
  });

  it('turns highlights into <mark> but leaves code alone', () => {
    const { markdown } = docToMarkdown(doc, tabs);
    expect(markdown).toContain('Hello <mark>world</mark>.');
    expect(markdown).toContain('Because `==x==`.');
  });

  it('makes local pictures resolve from the file and lists them', () => {
    const { markdown, images } = docToMarkdown(doc, tabs);
    expect(markdown).toContain('![shot](assets/a%20b.png)');
    expect(markdown).toContain('<img src="uploads/x.jpg"');
    expect(images).toEqual(['assets/a b.png', 'uploads/x.jpg']);
  });

  it('leaves fenced code as written', () => {
    const { markdown, images } = docToMarkdown(doc, tabs);
    expect(markdown).toContain('```md\n# not a heading\n![x](../assets/no.png)\n```');
    expect(images).not.toContain('assets/no.png');
  });

  it('exports one tab as its own document', () => {
    const { markdown } = docToMarkdown(doc, tabs, 'a');
    expect(markdown.startsWith('# Intro\n\nHello')).toBe(true);
    expect(markdown).toContain('\n## Why\n');
    expect(markdown).not.toContain('# Guide');
  });

  it('takes a first tab titled like the doc as its introduction', () => {
    const { markdown } = docToMarkdown(index('Guide', [{ id: 'a', title: 'Home' }, { id: 'b', title: 'More' }]), files({ a: '# Guide\n\nIntro.\n\n## Why\n\nx\n', b: '# More\n\ny\n' }));
    expect(markdown).toBe('# Guide\n\nIntro.\n\n## Why\n\nx\n\n## More\n\ny\n');
  });

  it('does not repeat the title of a one-tab doc', () => {
    const { markdown } = docToMarkdown(index('Notes', [{ id: 'm', title: 'Notes' }]), files({ m: '# Notes\n\n## A\n\ntext\n' }));
    expect(markdown).toBe('# Notes\n\n## A\n\ntext\n');
  });

  it('sees a fence that opens a list item or sits in a quote', () => {
    const { markdown, images } = docToMarkdown(index('D', [{ id: 'a', title: 'A' }]), files({ a: '- ```bash\n  # install\n  ```\n\n## Next\n\n==hi== ![](../assets/z.png)\n\n> ```\n> ==x==\n> ```\n' }));
    expect(markdown).toContain('  # install\n');
    expect(markdown).toContain('\n### Next\n');
    expect(markdown).toContain('<mark>hi</mark> ![](assets/z.png)');
    expect(markdown).toContain('> ==x==');
    expect(images).toEqual(['assets/z.png']);
  });

  it('keeps a # that ends a title, and a stray % in a picture path', () => {
    const { markdown, images } = docToMarkdown(index('C#', [{ id: 'a', title: 'x' }]), files({ a: '# C#\n\n![](../assets/50%off.png)\n' }));
    expect(markdown).toBe('# C#\n\n![](assets/50%off.png)\n');
    expect(images).toEqual(['assets/50%off.png']);
  });

  it('keeps remote pictures and handles an empty doc', () => {
    expect(docToMarkdown(index('D', [{ id: 'm', title: 'M' }]), files({ m: '![](https://x.dev/a.png)' })).images).toEqual([]);
    expect(docToMarkdown(index('Empty', []), files({})).markdown).toBe('# Empty\n');
  });
});

describe('markdownToTab', () => {
  it('reads <mark> as the editor highlight and leaves code alone', () => {
    expect(markdownToTab('a <mark>b</mark> `<mark>c</mark>`\n```\n<mark>d</mark>\n```')).toBe('a ==b== `<mark>c</mark>`\n```\n<mark>d</mark>\n```');
  });

  it('round-trips an export', () => {
    const { markdown } = docToMarkdown(index('T', [{ id: 'a', title: 'A' }]), files({ a: '# A\n\nx ==y== z\n' }));
    expect(markdownToTab(markdown)).toContain('x ==y== z');
  });
});
