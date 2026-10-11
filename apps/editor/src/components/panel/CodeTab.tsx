import { useState } from 'react';
import { attr, elementLabel, parseStyle, type DcDoc, type DcElement, type Inspect } from '@dc/core';
import { editElement } from '../../store';
import { Plus, Close } from '../icons';

const INHERITED = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space'];

function isColor(v: string) {
  return /^(#|rgb|hsl|oklch)/i.test(v.trim());
}

/** `body { … }` declarations from the artboard's <helmet><style>. */
function bodyRule(doc: DcDoc): Record<string, string> {
  const css = doc.elements.filter((e) => e.tag === 'style').map((s) => s.children.map((c) => (c.kind === 'text' ? c.text : '')).join('')).join('\n');
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/(?:^|[},\s])body\s*\{([^}]*)\}/g)) for (const d of parseStyle(m[1])) if (d.prop) out[d.prop] = d.value;
  return out;
}

export function CodeTab({ file, doc, el, info }: { file: string; doc: DcDoc; el: DcElement; info: Inspect | null }) {
  const tid = el.tid;
  const style = attr(el, 'style') ?? '';
  const decls = parseStyle(style).filter((d) => d.prop);
  const [fresh, setFresh] = useState('');
  const set = (s: Record<string, string | null>) => editElement(file, [{ kind: 'styles', tid, set: s }]);

  // inherited values, grouped by where they come from
  const own = new Set(decls.map((d) => d.prop));
  const groups: { from: string; props: [string, string][] }[] = [];
  const seen = new Set(own);
  for (let a = el.parent; a; a = a.parent) {
    const props = parseStyle(attr(a, 'style') ?? '')
      .filter((d) => INHERITED.includes(d.prop) && !seen.has(d.prop))
      .map((d) => [d.prop, d.value] as [string, string]);
    props.forEach(([p]) => seen.add(p));
    if (props.length) groups.push({ from: `<${a.tag}>`, props });
  }
  const body = Object.entries(bodyRule(doc)).filter(([p]) => INHERITED.includes(p) && !seen.has(p));
  if (body.length) groups.push({ from: 'body', props: body });

  const addFresh = () => {
    const parts = parseStyle(fresh).filter((d) => d.prop && d.value);
    if (!parts.length) return;
    set(Object.fromEntries(parts.map((d) => [d.prop, d.value])));
    setFresh('');
  };

  return (
    <div className="sec">
      <div className="hint" style={{ fontFamily: 'var(--mono)' }}>
        &lt;{el.tag}&gt; {elementLabel(el) ? `“${elementLabel(el)}”` : ''}
      </div>
      <div className="decls">
        {decls.map((d, i) => (
          <div className="decl" key={d.prop + i}>
            <span className="p">{d.prop}</span>
            <span className="v">
              {isColor(d.value) && <i style={{ background: d.value }} />}
              <input
                defaultValue={d.value}
                key={d.value}
                aria-label={d.prop}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                onBlur={(e) => e.currentTarget.value !== d.value && set({ [d.prop]: e.currentTarget.value.trim() || null })}
              />
            </span>
            <button className="ib" aria-label={`删除 ${d.prop}`} title="删除" onClick={() => set({ [d.prop]: null })} style={{ width: 20, height: 20 }}>
              <Close />
            </button>
          </div>
        ))}
        <input
          className="code-new"
          value={fresh}
          placeholder={decls.length ? '添加：color: red;' : '还没有样式。输入 color: red; 来添加'}
          aria-label="添加样式声明"
          onChange={(e) => setFresh(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') addFresh();
          }}
          onBlur={addFresh}
        />
      </div>
      {groups.map((g) => (
        <div key={g.from} className="decls">
          <div className="from">
            继承自 <code>{g.from}</code>
          </div>
          {g.props.map(([p, v]) => (
            <div className="decl" key={p}>
              <span className="p">{p}</span>
              <span className="v">
                {isColor(v) && <i style={{ background: v }} />}
                {v}
              </span>
              <button className="ib" aria-label={`在这个元素上覆盖 ${p}`} title="在这个元素上覆盖" onClick={() => set({ [p]: v })} style={{ width: 20, height: 20 }}>
                <Plus />
              </button>
            </div>
          ))}
        </div>
      ))}
      {info && (
        <div className="hint" style={{ marginTop: 4 }}>
          渲染尺寸 {Math.round(info.rect.w)} × {Math.round(info.rect.h)}
        </div>
      )}
    </div>
  );
}
