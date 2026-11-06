import { describe, expect, it } from 'vitest';
import { FieldError, applyHumanOps, editFields, fieldNear, parseDc, planField, rootElement } from '../src';
import { Window as HappyWindow } from 'happy-dom';

const PROPS = '{"logo":{"default":"uploads/a.png"},"title":{"default":"Hi"},"n":{"editor":"int","default":3},"cards":{"default":[{"img":"uploads/x.png"}]}}';
const FILE = (body: string) =>
  `<x-dc>${body}</x-dc><script type="text/x-dc" data-dc-script data-props='${PROPS}'>class Component extends DCLogic {}</script>`;
const document = new HappyWindow().document as unknown as Document;

function fieldsOf(body: string, tag?: string) {
  const doc = parseDc(FILE(body));
  const el = tag ? doc.elements.find((e) => e.tag === tag)! : rootElement(doc)!;
  return { doc, el, fields: editFields(doc, el) };
}
const apply = (src: string, ...ops: Parameters<typeof applyHumanOps>[1]) => applyHumanOps(src, ops, document).source;

describe('the fields of an element', () => {
  it('a picture has a source and an alt', () => {
    const { fields } = fieldsOf('<img src="uploads/a.png" alt="Logo" style="width:40px">');
    expect(fields.map((f) => [f.kind, f.value, f.binding.kind])).toEqual([
      ['src', 'uploads/a.png', 'literal'],
      ['alt', 'Logo', 'literal'],
    ]);
  });

  it('a card lists its parts in reading order', () => {
    const { fields } = fieldsOf(
      '<div><h2>Pro</h2><img src="uploads/a.png" alt=""><p>Save <b>20%</b> today</p><a href="https://x.dev">Buy</a><input placeholder="Email"></div>',
    );
    expect(fields.map((f) => `${f.kind}:${f.value}`)).toEqual([
      'text:Pro',
      'src:uploads/a.png',
      'alt:',
      'text:Save',
      'text:20%',
      'text:today',
      'text:Buy',
      'href:https://x.dev',
      'newTab:',
      'placeholder:Email',
    ]);
  });

  it('numbers the text nodes of an element, elements not counted', () => {
    const { fields } = fieldsOf('<p>Save <b>20%</b> today</p>', 'p');
    expect(fields.filter((f) => f.tid === 0).map((f) => f.run)).toEqual([0, 1]);
  });

  it('leaves out locked, hidden and non-content parts', () => {
    const { fields } = fieldsOf('<div><p data-lock>Kept</p><p data-hide>Gone</p><svg><text>Vec</text></svg><x-icon name="a"></x-icon><button>Go</button></div>');
    expect(fields.map((f) => f.value)).toEqual(['Go']);
  });

  it('reads a hole that is one text tweak as the tweak, and any other hole as read-only', () => {
    const { fields } = fieldsOf('<div><img src="{{logo}}" alt="{{alt}}"><p>Hello {{title}}!</p><p>{{title}}</p></div>');
    expect(fields.map((f) => [f.kind, f.value, f.binding])).toEqual([
      ['src', 'uploads/a.png', { kind: 'tweak', prop: 'logo' }],
      ['alt', '{{alt}}', { kind: 'readonly', why: 'data' }],
      ['text', 'Hello {{title}}!', { kind: 'readonly', why: 'data' }],
      ['text', 'Hi', { kind: 'tweak', prop: 'title' }],
    ]);
  });

  it('says a list row’s value comes from the row, and that the part is drawn once per row', () => {
    const { fields } = fieldsOf('<sc-for list="{{cards}}" as="c"><img src="{{c.img}}" alt="x"></sc-for>');
    expect(fields[0]).toMatchObject({ binding: { kind: 'readonly', why: 'row' }, repeated: true });
  });

  it('gives a styled word inside a link to the link', () => {
    const { fields } = fieldsOf('<a href="/x"><b>Read</b> more</a>');
    expect(fields.map((f) => [f.kind, f.role, f.owner])).toEqual([
      ['text', 'link', 0],
      ['text', 'link', 0],
      ['href', 'link', 0],
      ['newTab', 'link', 0],
    ]);
  });

  it('has nothing for a plain box', () => {
    expect(fieldsOf('<div style="width:10px"></div>').fields).toEqual([]);
  });

  it('finds the run that was clicked', () => {
    const { fields } = fieldsOf('<p>Save <b>20%</b> today</p>', 'p');
    expect(fieldNear(fields, ' today ')?.value).toBe('today');
    expect(fieldNear(fields, 'nothing')).toBeUndefined();
  });
});

describe('writing a field back', () => {
  const src = FILE('<div><img src="uploads/a.png" alt="Logo"><p>\n    Save <b>20%</b> today\n  </p><a href="/x">Buy</a></div>');
  const { fields } = (() => {
    const doc = parseDc(src);
    return { fields: editFields(doc, rootElement(doc)!) };
  })();
  const field = (kind: string, value?: string) => fields.find((f) => f.kind === kind && (value === undefined || f.value === value))!;
  const run = (f: ReturnType<typeof field>, value: string) => {
    const plan = planField(f, value);
    if (!('ops' in plan)) throw new Error('expected ops');
    return apply(src, ...plan.ops);
  };

  it('swaps a picture’s source and changes only that attribute', () => {
    expect(run(field('src'), 'uploads/b.png')).toBe(src.replace('uploads/a.png', 'uploads/b.png'));
  });

  it('keeps an empty alt as a decorative picture', () => {
    expect(run(field('alt'), '')).toBe(src.replace(' alt="Logo"', ' alt=""'));
  });

  it('retypes one run of a mixed paragraph and keeps the elements and the indentation', () => {
    const out = run(field('text', 'Save'), 'Take');
    expect(out).toBe(src.replace('Save <b>', 'Take <b>'));
    expect(run(field('text', 'today'), 'now')).toBe(src.replace('today\n', 'now\n'));
  });

  it('escapes what is typed', () => {
    expect(run(field('text', 'Buy'), 'Buy <3 & more')).toContain('Buy &lt;3 &amp; more</a>');
  });

  it('opens a link in a new tab with rel, and takes both away again', () => {
    const on = run(field('newTab'), 'on');
    expect(on).toContain('<a href="/x" target="_blank" rel="noopener">');
    const doc = parseDc(on);
    const again = editFields(doc, rootElement(doc)!).find((f) => f.kind === 'newTab')!;
    expect(again.value).toBe('on');
    const plan = planField(again, '');
    if (!('ops' in plan)) throw new Error('expected ops');
    expect(applyHumanOps(on, plan.ops, document).source).toBe(src);
  });

  it('writes a tweak-bound field to the tweak, and refuses a read-only one', () => {
    const bound = fieldsOf('<img src="{{logo}}" alt="x">').fields[0];
    expect(planField(bound, 'uploads/z.png')).toEqual({ tweak: { prop: 'logo', value: 'uploads/z.png' } });
    const data = fieldsOf('<img src="{{other}}" alt="x">').fields[0];
    expect(() => planField(data, 'q')).toThrow(FieldError);
  });

  it('says it when the text is no longer there', () => {
    const f = field('text', 'Save');
    const plan = planField({ ...f, run: 9 }, 'x');
    expect(() => apply(src, ...('ops' in plan ? plan.ops : []))).toThrow(/no longer/);
  });
});
