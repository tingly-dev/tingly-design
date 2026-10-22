import { describe, expect, it } from 'vitest';
import {
  blockKey,
  docsViewContext,
  gridToCsv,
  findQuote,
  isDocFile,
  joinBlocks,
  mergeBlocks,
  outlineOf,
  parseComments,
  parseDoc,
  projectKind,
  quoteAt,
  rebaseBlocks,
  splitBlocks,
  tabOrder,
  uniqueTabId,
  wordCount,
} from '../src';

const SRC = `# 上手手册

欢迎！这份文档写给*新同事*。

* 第一步
* 第二步

| 名称 | 说明 |
|:-----|-----:|
| a    | 1    |



\`\`\`sh
pnpm dev
\`\`\`

- [ ] 装好环境
- [x] 拿到账号
`;

describe('doc files', () => {
  it('knows its files and reads doc.json', () => {
    expect(isDocFile('doc.json') && isDocFile('tabs/intro.md') && isDocFile('comments.json')).toBe(true);
    expect(isDocFile('tabs/a b.md') || isDocFile('tabs/x.txt')).toBe(false);
    expect(projectKind(['doc.json', 'tabs/main.md'])).toBe('docs');
    const d = parseDoc('{"title":"T","tabs":[{"id":"a","title":"A"},{"id":"b","title":"B","parent":"a"},{"id":"c","parent":"b"},{"id":"a"},{"id":"bad id"}],"settings":{"width":"wide"},"x":1}');
    expect(d.tabs).toEqual([{ id: 'a', title: 'A' }, { id: 'b', title: 'B', parent: 'a' }, { id: 'c', title: 'c' }]);
    expect(d.settings).toEqual({ headingFont: 'sans', bodyFont: 'sans', width: 'wide', lang: 'zh-CN' });
    expect(d.x).toBe(1);
    expect(tabOrder({ ...d, tabs: [d.tabs[1], d.tabs[2], d.tabs[0]] }).map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(uniqueTabId(d, 'A')).toBe('a-2');
  });
});

describe('blocks', () => {
  it('split and join exactly', () => {
    const b = splitBlocks(SRC);
    expect(b.blocks.map((x) => x.type)).toEqual(['heading', 'paragraph', 'list', 'table', 'code', 'list']);
    expect(joinBlocks(b)).toBe(SRC);
    expect(b.gaps[3]).toBe('\n\n\n\n');
  });

  it('a block means the same however it is spelled', () => {
    expect(blockKey('* a\n* b')).toBe(blockKey('- a\n- b'));
    expect(blockKey('*x*')).toBe(blockKey('_x_'));
    expect(blockKey('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(blockKey('|a|b|\n|-|-|\n|1|2|'));
    expect(blockKey('a')).not.toBe(blockKey('b'));
  });

  it('keeps every unchanged block as written, whatever the editor wrote', () => {
    // the editor's spelling of the same tab, with one word changed
    const edited = `# 上手手册\n\n欢迎！这份文档写给_新同学_。\n\n- 第一步\n- 第二步\n\n| 名称 | 说明 |\n| :--- | ---: |\n| a | 1 |\n\n\`\`\`sh\npnpm dev\n\`\`\`\n\n- [ ] 装好环境\n- [x] 拿到账号\n`;
    const out = mergeBlocks(SRC, edited);
    expect(out).toBe(SRC.replace('*新同事*', '_新同学_'));
  });

  it('a table re-spelled keeps its alignment row only if it means the same', () => {
    const edited = SRC.replace('|:-----|-----:|', '| --- | --- |');
    // alignment is meaning: the editor dropped it, so the table takes the editor's text
    expect(mergeBlocks(SRC, edited)).toContain('| --- | --- |');
  });

  it('adds, removes and moves blocks', () => {
    const edited = `# 上手手册\n\n新的一段。\n\n欢迎！这份文档写给*新同事*。\n\n\`\`\`sh\npnpm dev\n\`\`\`\n`;
    const out = mergeBlocks(SRC, edited);
    expect(out).toBe('# 上手手册\n\n新的一段。\n\n欢迎！这份文档写给*新同事*。\n\n```sh\npnpm dev\n```\n');
    expect(mergeBlocks(SRC, '')).toBe('');
    expect(mergeBlocks('', '# A\n')).toBe('# A\n');
  });

  it('rebases my block edit onto a newer text', () => {
    const basis = 'A\n\nB\n\nC\n';
    const mine = 'A\n\nB2\n\nC\n';
    const theirs = 'A0\n\nA\n\nB\n\nC\n\nD\n';
    expect(rebaseBlocks(basis, mine, theirs)).toBe('A0\n\nA\n\nB2\n\nC\n\nD\n');
    // both changed different blocks
    expect(rebaseBlocks(basis, 'A\n\nB\n\nC!\n', 'A!\n\nB\n\nC\n')).toBe('A!\n\nB\n\nC!\n');
    // my insert after B lands after B in theirs
    expect(rebaseBlocks(basis, 'A\n\nB\n\nnew\n\nC\n', 'X\n\nA\n\nB\n\nC\n')).toBe('X\n\nA\n\nB\n\nnew\n\nC\n');
    // I deleted B
    expect(rebaseBlocks(basis, 'A\n\nC\n', 'A\n\nB\n\nC\n\nD\n')).toBe('A\n\nC\n\nD\n');
  });
});

describe('reading', () => {
  it('outlines and counts', () => {
    expect(outlineOf('# A\n\npara\n\n## B *c*\n')).toEqual([
      { level: 1, text: 'A', block: 0 },
      { level: 2, text: 'B c', block: 2 },
    ]);
    expect(wordCount('# 你好 world\n\nhello, 世界 2026')).toBe(7);
  });

  it('anchors comments by quote, telling repeats apart', () => {
    const text = 'the cat sat. the cat ran.';
    const q = quoteAt(text, 17, 20);
    expect(q.quote).toBe('cat');
    expect(findQuote(text, q)).toEqual({ from: 17, to: 20 });
    expect(findQuote('a cat ran. the cat sat. the cat ran.', q)).toEqual({ from: 28, to: 31 });
    expect(findQuote(text, { quote: 'dog' })).toBeNull();
    const c = parseComments('{"threads":[{"id":"t1","tab":"a","quote":"x","comments":[{"author":"me","text":"hi"}]},{"id":2}]}');
    expect(c.threads).toEqual([{ id: 't1', tab: 'a', quote: 'x', comments: [{ id: 't1-0', author: 'me', text: 'hi', at: '' }] }]);
  });
});

describe('a changed block keeps its unchanged lines', () => {
  it('ticking one task leaves the other items as written', () => {
    const src = '# T\n\n* [ ] one\n* [ ] see http://x.test\n* [ ] *three*\n';
    const edited = '# T\n\n- [x] one\n- [ ] see [http://x.test](http://x.test)\n- [ ] _three_\n';
    expect(mergeBlocks(src, edited)).toBe('# T\n\n* [x] one\n* [ ] see http://x.test\n* [ ] *three*\n');
  });

  it('retyping one table cell changes one row', () => {
    const src = '| a | b |\n|:--|--:|\n| 1 | 2 |\n| 3 | 4 |\n';
    const edited = '| a   | b   |\n| :-- | --: |\n| 1   | 2   |\n| 3   | 40  |\n';
    expect(mergeBlocks(src, edited)).toBe('| a | b |\n|:--|--:|\n| 1 | 2 |\n| 3 | 40 |\n');
  });

  it('a code block keeps its lines, exactly', () => {
    expect(mergeBlocks('```\n*a*\nb\n```\n', '```\n_a_\nb\n```\n')).toBe('```\n_a_\nb\n```\n');
    expect(mergeBlocks('```\na\nb\n```\n', '```\na\nb2\n```\n')).toBe('```\na\nb2\n```\n');
  });

  it('a block that changed type takes the editor text', () => {
    expect(mergeBlocks('A\n\npara\n', 'A\n\n## para\n')).toBe('A\n\n## para\n');
  });
});

describe('gridToCsv', () => {
  it('names columns from the header row, made unique and never empty', () => {
    expect(gridToCsv([['a', 'a', '', 'a 2'], ['1', '2', '3', '4']], true)).toBe('a,a 2,column 3,a 2 2\n1,2,3,4\n');
  });
  it('keeps every row as data when there is no header row', () => {
    expect(gridToCsv([['x', 'y'], ['1', '2,3']], false)).toBe('column 1,column 2\nx,y\n1,"2,3"\n');
  });
});

describe('docsViewContext', () => {
  it('names the tab and the cursor, preferring a selection to the block', () => {
    const c = docsViewContext({ title: 'Plan', file: 'tabs/plan.md', heading: 'Risks', selection: 'a b', block: 'ignored' });
    expect(c).toContain('"Plan" open (tabs/plan.md)');
    expect(c).toContain('section "Risks"');
    expect(c).toContain('a b');
    expect(c).not.toContain('ignored');
  });
  it('leaves out an empty block and a missing thread', () => {
    expect(docsViewContext({ file: 'tabs/a.md', block: '  ' })).toBe('The person has the tab "tabs/a.md" open (tabs/a.md).');
  });
});
