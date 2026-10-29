import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { markdownToDocx } from '../src/docx';

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

function read(md: string, o = {}) {
  const files = unzipSync(markdownToDocx(md, o));
  return { files, doc: strFromU8(files['word/document.xml']!), rels: strFromU8(files['word/_rels/document.xml.rels']!), num: strFromU8(files['word/numbering.xml']!) };
}

describe('markdownToDocx', () => {
  it('writes the package parts Word needs', () => {
    const { files } = read('# Title\n\nHello');
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/numbering.xml', 'word/styles.xml']);
  });

  it('is deterministic', () => {
    expect(markdownToDocx('# A\n\nb **c**')).toEqual(markdownToDocx('# A\n\nb **c**'));
  });

  it('maps headings, emphasis, code, links and coloured words', () => {
    const { doc, rels } = read('## Sec\n\n**bold** *it* ~~gone~~ `a<b` [site](https://x.test/a?b=1&c=2) <mark>hl</mark> <span data-color="red">hot</span> end & more\n', { colors: { red: '#c62828' } });
    expect(doc).toContain('<w:pStyle w:val="Heading2"/>');
    expect(doc).toContain('<w:b/>');
    expect(doc).toContain('<w:i/>');
    expect(doc).toContain('<w:strike/>');
    expect(doc).toContain('>a&lt;b<');
    expect(doc).toContain('<w:hyperlink r:id=');
    expect(rels).toContain('Target="https://x.test/a?b=1&amp;c=2" TargetMode="External"');
    expect(doc).toContain('<w:highlight w:val="yellow"/>');
    expect(doc).toContain('<w:color w:val="C62828"/>');
    expect(doc).toContain('end &amp; more');
    // the colour and the highlight stop where their tags do
    expect(doc.split('end').length).toBe(2);
    expect(doc.slice(doc.indexOf('end &amp;') - 80, doc.indexOf('end &amp;'))).not.toContain('highlight');
  });

  it('numbers each ordered list from its own start and nests bullets', () => {
    const { doc, num } = read('1. a\n2. b\n\ntext\n\n3. c\n   - nested\n');
    expect(doc.match(/<w:numId w:val="2"\/>/g)?.length).toBe(2);
    expect(doc).toContain('<w:numId w:val="3"/>');
    expect(doc).toContain('<w:ilvl w:val="1"/><w:numId w:val="1"/>');
    expect(num).toContain('<w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"/>');
  });

  it('writes tasks, quotes, rules, code lines and tables', () => {
    const { doc } = read('- [x] done\n- [ ] todo\n\n> quoted\n\n---\n\n```js\nlet a = 1 < 2;\n\nb()\n```\n\n| a | b |\n|:--|--:|\n| 1 | 2 |\n');
    expect(doc).toContain('☑ ');
    expect(doc).toContain('☐ ');
    expect(doc).toContain('<w:pStyle w:val="Quote"/>');
    expect(doc).toContain('<w:pBdr><w:bottom');
    expect(doc.match(/<w:pStyle w:val="CodeBlock"\/>/g)?.length).toBe(3);
    expect(doc).toContain('let a = 1 &lt; 2;');
    expect(doc).toContain('<w:tblHeader/>');
    expect(doc).toContain('<w:jc w:val="right"/>');
  });

  it('embeds a picture it has and describes one it does not', () => {
    const { files, doc, rels } = read('![shot](assets/a%20b.png)\n\n![gone](assets/none.png)', { images: new Map([['assets/a b.png', png]]) });
    expect(files['word/media/image1.png']).toBeDefined();
    expect(rels).toContain('Target="media/image1.png"');
    expect(doc).toContain('<a:blip r:embed=');
    expect(doc).toContain('descr="shot"');
    expect(doc).toContain('[gone]');
    expect(strFromU8(files['[Content_Types].xml']!)).toContain('Extension="png"');
  });

  it('keeps entities in code as written and turns the ones in text into characters', () => {
    const { doc } = read('&copy; 2025&nbsp;x &#169; &#x41;\n\n```html\n&lt;div&gt; a &amp;&amp; b\n```\n');
    expect(doc).toContain('© 2025\u00a0x © A');
    expect(doc).toContain('&amp;lt;div&amp;gt; a &amp;amp;&amp;amp; b');
  });

  it('indents a list inside a quote from its own level, and sizes table columns by their content', () => {
    const { doc } = read('> - one\n>   - two\n\n| a | long column here with words |\n|---|---|\n| 1 | and its long content in the cell |\n');
    expect(doc).toContain('<w:ind w:left="1080" w:hanging="360"/>');
    expect(doc).toContain('<w:ind w:left="1800" w:hanging="360"/>');
    const grid = [...doc.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(grid[1]! > grid[0]! * 2).toBe(true);
  });

  it('keeps a script from breaking out of the XML', () => {
    const { doc } = read('x \u0001 <script>"a"</script> y');
    expect(doc).not.toContain('\u0001');
    expect(doc).not.toContain('<script>');
  });
});
