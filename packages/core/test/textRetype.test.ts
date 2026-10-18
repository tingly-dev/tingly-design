import { describe, expect, it } from 'vitest';
import { RetypeError, parseDc, planRetype, retypeKind, setListItemField, setPropDefault } from '../src';

const PROPS = '{"name":{"default":"Ann"},"n":{"editor":"int","default":3},"plans":{"default":[{"name":"Solo","price":"$9"},{"name":"Pro","price":"$19"}]}}';
const FILE = (body: string) =>
  `<x-dc>${body}</x-dc><script type="text/x-dc" data-dc-script data-props='${PROPS}'>class Component extends DCLogic {}</script>`;

function find(body: string, tag: string) {
  const doc = parseDc(FILE(body));
  return { doc, el: doc.elements.find((e) => e.tag === tag)! };
}

describe('retyping text with holes', () => {
  const body = '<p>Hello {{name}}!</p>';

  it('tells how an element can be retyped', () => {
    expect(retypeKind(find('<p>Hello</p>', 'p').doc, find('<p>Hello</p>', 'p').el)).toBe('literal');
    expect(retypeKind(find('<p>{{name}}</p>', 'p').doc, find('<p>{{name}}</p>', 'p').el)).toBe('tweak');
    const m = find(body, 'p');
    expect(retypeKind(m.doc, m.el)).toBe('mixed');
    const d = find('<p>{{title}}</p>', 'p');
    expect(retypeKind(d.doc, d.el)).toBe('data');
    const e = find('<p>{{n}}</p>', 'p');
    expect(retypeKind(e.doc, e.el)).toBe('data');
    const x = find('<p>a <b>b</b> {{name}}</p>', 'p');
    expect(retypeKind(x.doc, x.el)).toBeNull();
  });

  it('changes the tweak when the edit is inside the hole', () => {
    const { doc, el } = find(body, 'p');
    expect(planRetype(doc, el, 'Hello Ann!', 'Hello Bob!')).toEqual({ template: null, sets: [{ prop: 'name', value: 'Bob' }] });
  });

  it('gives typing at the seam to the value', () => {
    const { doc, el } = find(body, 'p');
    expect(planRetype(doc, el, 'Hello Ann!', 'Hello Anna!').sets).toEqual([{ prop: 'name', value: 'Anna' }]);
    expect(planRetype(doc, el, 'Hello Ann!', 'Hello Big Ann!').sets).toEqual([{ prop: 'name', value: 'Big Ann' }]);
  });

  it('rewrites a literal piece and keeps the hole', () => {
    const { doc, el } = find(body, 'p');
    expect(planRetype(doc, el, 'Hello Ann!', 'Hi Ann!')).toEqual({ template: 'Hi {{name}}!', sets: [] });
    expect(planRetype(doc, el, 'Hello Ann!', 'Hello Ann?')).toEqual({ template: 'Hello {{name}}?', sets: [] });
  });

  it('refuses an edit across pieces, in data, or that does not line up', () => {
    const { doc, el } = find(body, 'p');
    expect(() => planRetype(doc, el, 'Hello Ann!', 'Bye')).toThrow(RetypeError);
    expect(() => planRetype(doc, el, 'Hello Ann!', 'Hello Bob?')).toThrowError(expect.objectContaining({ code: 'span' }));
    expect(() => planRetype(doc, el, 'HELLO ANN!', 'HELLO BOB!')).toThrowError(expect.objectContaining({ code: 'nomatch' }));
    const d = find('<p>Total {{sum}}</p>', 'p');
    expect(() => planRetype(d.doc, d.el, 'Total 5', 'Total 6')).toThrowError(expect.objectContaining({ code: 'data' }));
    expect(planRetype(d.doc, d.el, 'Total 5', 'Sum 5').template).toBe('Sum {{sum}}');
  });

  it('is a no-op when nothing changed (whitespace aside)', () => {
    const { doc, el } = find(body, 'p');
    expect(planRetype(doc, el, 'Hello Ann!', 'Hello  Ann! ')).toEqual({ template: null, sets: [] });
  });

  it('edits one row of a list tweak from inside the loop', () => {
    const loop = '<sc-for list="{{plans}}" as="plan"><p>{{plan.name}} for {{plan.price}}</p></sc-for>';
    const { doc, el } = find(loop, 'p');
    expect(retypeKind(doc, el)).toBe('mixed');
    expect(planRetype(doc, el, 'Pro for $19', 'Team for $19', 1).sets).toEqual([{ prop: 'plans', index: 1, key: 'name', value: 'Team' }]);
    expect(planRetype(doc, el, 'Pro for $19', 'Pro for $29', 1).sets).toEqual([{ prop: 'plans', index: 1, key: 'price', value: '$29' }]);
    expect(planRetype(doc, el, 'Pro for $19', 'Pro per $19', 1).template).toBe('{{plan.name}} per {{plan.price}}');
    // the first row's numbers must not leak into another row
    expect(planRetype(doc, el, 'Solo for $9', 'Solo for $10', 0).sets).toEqual([{ prop: 'plans', index: 0, key: 'price', value: '$10' }]);
    // without the row, a hole from a list is data
    expect(() => planRetype(doc, el, 'Pro for $19', 'Team for $19')).toThrowError(expect.objectContaining({ code: 'data' }));
  });

  it('writes a row field back and leaves the other rows alone', () => {
    const src = FILE('<p>x</p>');
    const out = setListItemField(src, 'plans', 1, 'name', 'Team');
    const props = parseDc(out.source).props as Record<string, { default: unknown }>;
    expect(props.plans.default).toEqual([{ name: 'Solo', price: '$9' }, { name: 'Team', price: '$19' }]);
    expect(setPropDefault(out.source, 'name', 'Bob').source).toContain('"name":{"default":"Bob"}');
    expect(() => setListItemField(src, 'plans', 5, 'name', 'x')).toThrow();
  });
});
