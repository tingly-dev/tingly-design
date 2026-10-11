import { useMemo, useState } from 'react';
import { BUILDS, TRANSITIONS, attr, checkSlide, getStyle, googleFace, layerTree, rootElement, slideFile, type Layer } from '@dc/core';
import { display, editDeck, editElement, parsed, useDeck, useStore } from '../../store';
import { isHidden, setSectionAttr, slideTitle, toggleHidden } from '../../slides';
import { ColorField, Field, Row, Select } from '../panel/fields';
import { Chevron, RoleIcon } from '../icons';

const ROLE_ZH: Record<string, string> = {
  Slide: '幻灯片',
  Column: '纵向',
  Row: '横向',
  Grid: '网格',
  Text: '文字',
  Image: '图片',
  Vector: '矢量',
  Link: '链接',
  Group: '组',
  Embed: '动态嵌入',
  Shape: '形状',
  Icon: '图标',
  Connector: '连线',
  Table: '表格',
  Notes: '备注',
};

function Rows({ file, layers, depth, open, toggle }: { file: string; layers: Layer[]; depth: number; open: Set<number>; toggle: (t: number) => void }) {
  const sel = useStore((s) => (s.selection?.kind === 'el' && s.selection.file === file ? s.selection.tid : null));
  return (
    <>
      {layers.map((l) => (
        <div key={l.tid}>
          <div
            className="lr"
            role="treeitem"
            aria-selected={sel === l.tid}
            aria-expanded={l.children.length ? open.has(l.tid) : undefined}
            data-key={`${file}#${l.tid}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            onClick={() => useStore.setState({ selection: { kind: 'el', file, tid: l.tid } })}
            onMouseEnter={() => useStore.setState({ layerHover: { file, tid: l.tid } })}
            onMouseLeave={() => useStore.setState({ layerHover: null })}
          >
            {l.children.length ? (
              <button className="tw" aria-label={open.has(l.tid) ? '收起' : '展开'} onClick={(e) => (e.stopPropagation(), toggle(l.tid))}>
                <Chevron open={open.has(l.tid)} />
              </button>
            ) : (
              <span className="tw" />
            )}
            <span className="ri">
              <RoleIcon role={l.role === 'Slide' ? 'Artboard' : l.role === 'Notes' ? 'Note' : l.role === 'Connector' ? 'Arrow' : l.role} />
            </span>
            <span className="rn">{ROLE_ZH[l.role] ?? l.role}</span>
            {l.label && <span className="rl">“{l.label}”</span>}
          </div>
          {open.has(l.tid) && l.children.length > 0 && <Rows file={file} layers={l.children} depth={depth + 1} open={open} toggle={toggle} />}
        </div>
      ))}
    </>
  );
}

/** The current slide's layers (the deck's other slides live in the strip). */
export function SlideLayers() {
  const id = useStore((s) => s.slide);
  const file = id ? slideFile(id) : '';
  const source = useStore((s) => (file ? display(s, file) : undefined));
  const sel = useStore((s) => s.selection);
  const layers = useMemo(() => (source ? layerTree(parsed(source)) : []), [source]);
  const [manual, setManual] = useState<Set<number>>(() => new Set());
  // everything above the selection is open
  const open = useMemo(() => {
    const o = new Set(manual);
    const doc = source ? parsed(source) : null;
    if (doc) {
      const root = rootElement(doc);
      if (root) o.add(root.tid);
      if (sel?.kind === 'el' && sel.file === file) for (let p = doc.elements[sel.tid]?.parent; p; p = p.parent) o.add(p.tid);
    }
    return o;
  }, [manual, source, sel, file]);
  const toggle = (t: number) =>
    setManual((m) => {
      const n = new Set(m);
      if (open.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  if (!id) return <div className="layers" />;
  return (
    <div className="layers" role="tree" aria-label="图层">
      <Rows file={file} layers={layers} depth={0} open={open} toggle={toggle} />
    </div>
  );
}

const TRANSITION_ZH: Record<string, string> = { '': '无', fade: '淡入淡出', push: '推入', magic: '神奇移动' };
const BUILD_ZH: Record<string, string> = { '': '无', fade: '淡入', rise: '上浮', drop: '落下', left: '从左', right: '从右', scale: '缩放', pop: '弹出' };

/** A whole slide selected: its id, look, transition, skipping, and the subset check. */
export function SlideProps({ file }: { file: string }) {
  const id = file.replace(/^slides\/|\.html$/g, '');
  const source = useStore((s) => display(s, file));
  const doc = source ? parsed(source) : null;
  const root = doc ? rootElement(doc) : undefined;
  const issues = useMemo(() => (doc ? checkSlide(doc, id) : []), [doc, id]);
  if (!root) return <div className="empty">这一页还没有内容。</div>;
  const style = attr(root, 'style') ?? '';
  const set = (prop: string, value: string | null) => editElement(file, [{ kind: 'style', tid: root.tid, prop, value }]);
  return (
    <div className="sec">
      <h3>幻灯片</h3>
      <Row label="标题">
        <span className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {slideTitle(source, id)}
        </span>
      </Row>
      <Row label="编号">
        <code className="hint">{id}</code>
      </Row>
      <Row label="背景">
        <ColorField value={getStyle(style, 'background') ?? ''} onCommit={(v) => set('background', v || null)} label="背景" allowNone={false} />
      </Row>
      <Row label="文字色">
        <ColorField value={getStyle(style, 'color') ?? ''} onCommit={(v) => set('color', v || null)} label="文字色" />
      </Row>
      <Row label="边距">
        <Field value={getStyle(style, 'padding') ?? ''} placeholder="128px" onCommit={(v) => set('padding', v.trim() || null)} label="边距" numeric={false} />
      </Row>
      <Row label="切换">
        <Select
          value={attr(root, 'data-transition') ?? ''}
          options={['', ...TRANSITIONS].map((t) => ({ value: t, label: TRANSITION_ZH[t] }))}
          onChange={(v) => setSectionAttr(id, 'data-transition', v || null)}
          label="离开这一页时的切换效果"
        />
      </Row>
      <Row label="放映">
        <label className="chk">
          <input type="checkbox" checked={isHidden(id)} onChange={() => toggleHidden(id)} /> 放映时跳过
        </label>
      </Row>
      <h3>格式检查</h3>
      {issues.length ? (
        <ul className="issue-list">
          {issues.map((i, n) => (
            <li key={n} className={i.level} onClick={() => i.tid !== null && useStore.setState({ selection: { kind: 'el', file, tid: i.tid } })}>
              {i.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          这一页符合幻灯片格式。
        </p>
      )}
    </div>
  );
}

/** Builds on a pinned element (present mode only). */
export function BuildRow({ file, tid }: { file: string; tid: number }) {
  const source = useStore((s) => display(s, file));
  const el = source ? parsed(source).elements[tid] : undefined;
  if (!el || !/position\s*:\s*absolute/.test(attr(el, 'style') ?? '')) return null;
  const cur = attr(el, 'data-build-in') ?? '';
  const effect = cur.split(/\s+/)[0] ?? '';
  const auto = /\bauto\b/.test(cur);
  const write = (eff: string, a: boolean) =>
    editElement(file, [{ kind: 'attr', tid, name: 'data-build-in', value: eff ? `${eff}${a ? ' auto' : ''}` : null }]);
  return (
    <div className="sec">
      <h3>出场动画</h3>
      <Row label="效果">
        <Select value={effect} options={['', ...BUILDS].map((b) => ({ value: b, label: BUILD_ZH[b] }))} onChange={(v) => write(v, auto)} label="出场动画" />
      </Row>
      {effect && (
        <Row label="时机">
          <Select value={auto ? 'auto' : 'click'} options={[{ value: 'click', label: '点击时' }, { value: 'auto', label: '紧跟上一个' }]} onChange={(v) => write(effect, v === 'auto')} label="时机" />
        </Row>
      )}
    </div>
  );
}

/** Nothing selected: the deck itself — its name and typefaces. */
export function DeckProps() {
  const deck = useDeck();
  const [font, setFont] = useState('');
  const faces = Object.entries(deck.faces);
  return (
    <div className="sec">
      <div className="empty" style={{ textAlign: 'center', padding: '8px 0 4px' }}>
        <div style={{ color: 'var(--ink)', fontWeight: 500 }}>未选中任何内容</div>
        点击幻灯片上的元素来编辑，双击文字直接改。
      </div>
      <h3>这套幻灯片</h3>
      <Row label="名称">
        <Field value={deck.title} numeric={false} label="幻灯片名称" onCommit={(v) => v.trim() && editDeck((d) => (d.title = v.trim()), `title → ${v.trim()}`)} />
      </Row>
      <h3>字体</h3>
      {faces.length ? (
        faces.map(([k, f]) => (
          <div key={k} className="face">
            <span className="fname" style={{ fontFamily: `'${f.family}', sans-serif` }}>
              {f.family}
            </span>
            <button className="btn outline" onClick={() => editDeck((d) => void delete d.faces[k], `typeface ${f.family} removed`)}>
                移除
            </button>
          </div>
        ))
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          还没有声明字体；幻灯片用系统字体。
        </p>
      )}
      <form
        className="faceadd"
        onSubmit={(e) => {
          e.preventDefault();
          const f = font.trim();
          if (!f) return;
          if (Object.keys(deck.faces).length >= 4) return;
          const [key, face] = googleFace(f);
          editDeck((d) => (d.faces[key] = face), `typeface ${f} added`);
          setFont('');
        }}
      >
        <input className="input" placeholder="Google Fonts 字体名，如 Noto Serif SC" value={font} onChange={(e) => setFont(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="添加字体" />
        <button className="btn outline" type="submit" disabled={faces.length >= 4}>
          添加
        </button>
      </form>
      <p className="hint" style={{ margin: 0 }}>
        最多 4 种。在元素的 font-family 里写字体名即可使用。
      </p>
      <h3>快捷键</h3>
      <p className="hint" style={{ margin: 0 }}>
        ↑↓ / PageUp PageDown 切换幻灯片（未选中元素时）· ⌘D 复制 · ⌫ 删除 · ⇧↵ 选中上一级 · ↵ 选中下一级 · ⌘Z 撤销 · F5 放映
      </p>
    </div>
  );
}
