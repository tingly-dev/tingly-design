import { useMemo, useState } from 'react';
import {
  TRANSITION_KINDS,
  attr,
  checkScene,
  formatTime,
  getStyle,
  parseStyle,
  parseTime,
  rootElement,
  sceneIdOf,
  sceneVisibility,
  type DcDoc,
  type DcElement,
} from '@dc/core';
import { display, editElement, parsed, useStore } from '../../store';
import { FORMAT_PRESETS, addFormat, editMotion, motionOf, overridesOf, removeFormat, setFormatSize } from '../../motion';
import { ColorField, Field, Row, Select } from '../panel/fields';
import { SlideLayers } from '../slides/SlidePanel';

const TRANSITION_ZH: Record<string, string> = { cut: '直接切', fade: '淡入淡出', push: '推入', magic: '神奇移动' };

function useMotion() {
  const text = useStore((s) => display(s, 'motion.json'));
  return useMemo(() => motionOf(useStore.getState()), [text]); // eslint-disable-line react-hooks/exhaustive-deps
}

const sizeLabel = (size: [number, number]) => `${size[0]}×${size[1]}`;

/**
 * Elements of a scene that are off screen at a time, with when they are on
 * (an element is off while any of its ancestors is).
 */
export function awayAt(doc: DcDoc, format: string, formats: string[], at: number): Map<number, string> {
  const { windows } = sceneVisibility(doc, format, formats);
  const out = new Map<number, string>();
  for (const el of doc.elements) {
    let from = 0;
    let to = Infinity;
    let known = false;
    for (let p: DcElement | null = el; p; p = p.parent) {
      const w = windows.get(p.tid);
      if (!w) continue;
      known = true;
      from = Math.max(from, w.from);
      to = Math.min(to, w.to);
    }
    if (!known) {
      // not drawn in this format at all
      if (attr(el, 'data-only') !== undefined || el.parent) out.set(el.tid, `不在 ${format}`);
      continue;
    }
    if (at < from) out.set(el.tid, `${formatTime(Math.round(from))} 入场`);
    else if (at > to) out.set(el.tid, `${formatTime(Math.round(to))} 已离场`);
  }
  return out;
}

/** Where a style change lands, and what this format already sets on its own. */
export function FormatNote({ file, el }: { file: string; el: DcElement }) {
  const view = useStore((s) => s.motionView);
  const m = useMotion();
  if (!view) return null;
  const formats = Object.keys(m.formats);
  if (formats.length < 2) return null;
  const own = view.format !== view.primary;
  const name = `data-${view.format}`;
  const over = parseStyle(attr(el, name) ?? '').filter((d) => d.prop);
  const drop = (prop: string | null) => {
    const left = prop === null ? [] : over.filter((d) => d.prop !== prop);
    editElement(file, [{ kind: 'attr', tid: el.tid, name, value: left.length ? left.map((d) => `${d.prop}:${d.value}`).join(';') : null }]);
  };
  return (
    <div className="sec mfmt">
      <div className="mfmt-where">
        改动写到：
        <b>{own ? `仅 ${view.format}（${sizeLabel(m.formats[view.format].size)}）` : '所有尺寸'}</b>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {own ? '文字和时间仍然所有尺寸共用；样式只改这个尺寸。' : `在其他尺寸（${formats.filter((f) => f !== view.primary).join('、')}）里改，只会改那个尺寸。`}
      </p>
      {own && over.length > 0 && (
        <div className="mover">
          <span className="hint">这个尺寸单独设了：</span>
          {over.map((d) => (
            <button key={d.prop} className="chip" title={`${d.prop}: ${d.value}。点一下，改回所有尺寸共用的值`} onClick={() => drop(d.prop)}>
              {d.prop} ×
            </button>
          ))}
          <button className="btn ghost" onClick={() => drop(null)}>
            全部用共享值
          </button>
        </div>
      )}
    </div>
  );
}

/** The scene itself selected: its look, length, how it leaves, and its checks. */
export function SceneProps({ file }: { file: string }) {
  const id = sceneIdOf(file) ?? '';
  const source = useStore((s) => display(s, file));
  const doc = source ? parsed(source) : null;
  const root = doc ? rootElement(doc) : undefined;
  const issues = useMemo(() => (doc ? checkScene(doc, id).filter((i) => i.level !== 'note') : []), [doc, id]);
  if (!root) return <div className="empty">这个场景还没有内容。</div>;
  const style = attr(root, 'style') ?? '';
  const set = (prop: string, value: string | null) => editElement(file, [{ kind: 'style', tid: root.tid, prop, value }]);
  const setAttr = (name: string, value: string | null) => editElement(file, [{ kind: 'attr', tid: root.tid, name, value }]);
  const tr = (attr(root, 'data-transition') ?? '').trim().split(/\s+/);
  const trKind = tr[0] || 'cut';
  const trMs = tr[1] ?? '';
  return (
    <div className="sec">
      <h3>场景</h3>
      <Row label="编号">
        <code className="hint">{id}</code>
      </Row>
      <Row label="时长" title="data-duration：这个场景播放多久（播放速度之前）">
        <Field
          value={attr(root, 'data-duration') ?? ''}
          placeholder="4s"
          numeric={false}
          label="场景时长"
          onCommit={(v) => {
            const t = v.trim();
            if (!t) return setAttr('data-duration', null);
            const ms = parseTime(/^\d+(\.\d+)?$/.test(t) ? `${t}s` : t);
            if (ms !== null && ms > 0) setAttr('data-duration', formatTime(ms));
          }}
        />
      </Row>
      <Row label="离开时">
        <Select
          value={trKind}
          options={TRANSITION_KINDS.map((k) => ({ value: k, label: TRANSITION_ZH[k] }))}
          onChange={(v) => setAttr('data-transition', v === 'cut' ? null : `${v}${trMs ? ' ' + trMs : ''}`)}
          label="转场"
        />
      </Row>
      {trKind !== 'cut' && (
        <Row label="转场时长">
          <Field
            value={trMs}
            placeholder="500ms"
            numeric={false}
            label="转场时长"
            onCommit={(v) => {
              const ms = parseTime(/^\d+$/.test(v.trim()) ? `${v.trim()}ms` : v.trim());
              setAttr('data-transition', ms ? `${trKind} ${formatTime(ms)}` : trKind);
            }}
          />
        </Row>
      )}
      <Row label="背景">
        <ColorField value={getStyle(style, 'background') ?? ''} onCommit={(v) => set('background', v || null)} label="背景" allowNone={false} />
      </Row>
      <Row label="文字色">
        <ColorField value={getStyle(style, 'color') ?? ''} onCommit={(v) => set('color', v || null)} label="文字色" />
      </Row>
      <h3>检查</h3>
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
          这个场景符合格式，时间上也没有问题。
        </p>
      )}
    </div>
  );
}

/** Nothing selected: the piece itself, with its sizes set by hand. */
export function MotionProps() {
  const m = useMotion();
  const names = Object.keys(m.formats);
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState({ name: '', w: '', h: '' });
  const num = (v: string) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);
  const add = (name: string, size: [number, number]) => {
    if (addFormat(name, size)) {
      setAdding(false);
      setCustom({ name: '', w: '', h: '' });
      const view = useStore.getState().motionView;
      if (view) useStore.setState({ motionView: { ...view, format: name } });
    }
  };
  const free = FORMAT_PRESETS.filter((p) => !m.formats[p.name]);
  return (
    <div className="sec">
      <div className="empty" style={{ textAlign: 'center', padding: '8px 0 4px' }}>
        <div style={{ color: 'var(--ink)', fontWeight: 500 }}>未选中任何内容</div>
        暂停时点画面上的元素来编辑，双击文字直接改。
      </div>
      <h3>这段动效</h3>
      <Row label="名称">
        <Field value={m.title} numeric={false} label="动效名称" onCommit={(v) => v.trim() && editMotion((r) => (r.title = v.trim()), `title → ${v.trim()}`)} />
      </Row>
      <Row label="帧率">
        <Field
          value={String(m.fps)}
          unit="fps"
          label="帧率"
          onCommit={(v) => {
            const n = num(v);
            if (n >= 1 && n <= 120) editMotion((r) => (r.fps = n), `fps → ${n}`);
          }}
        />
      </Row>
      <h3>尺寸</h3>
      <div className="mformats">
        {names.map((name, i) => (
          <div key={name} className="mformat">
            <span className="mfname">
              {name}
              {i === 0 && <span className="faint">主尺寸</span>}
            </span>
            <Field value={String(m.formats[name].size[0])} pre="W" label={`${name} 宽`} onCommit={(v) => num(v) > 0 && setFormatSize(name, [num(v), m.formats[name].size[1]])} />
            <Field value={String(m.formats[name].size[1])} pre="H" label={`${name} 高`} onCommit={(v) => num(v) > 0 && setFormatSize(name, [m.formats[name].size[0], num(v)])} />
            {i > 0 ? (
              <button
                className="ib"
                aria-label={`删除尺寸 ${name}`}
                title="删除这个尺寸"
                onClick={() => {
                  const n = overridesOf(name);
                  if (confirm(`删除尺寸 ${name}？${n ? `场景里只属于它的 ${n} 处设置也会一起删掉。` : ''}`)) removeFormat(name);
                }}
              >
                ×
              </button>
            ) : (
              <span className="ib" />
            )}
          </div>
        ))}
      </div>
      {adding ? (
        <div className="maddfmt">
          {free.map((p) => (
            <button key={p.name} className="btn outline" onClick={() => add(p.name, p.size)}>
              {p.label} <span className="faint">{sizeLabel(p.size)}</span>
            </button>
          ))}
          <form
            className="mcustom"
            onSubmit={(e) => {
              e.preventDefault();
              const w = num(custom.w);
              const h = num(custom.h);
              if (w > 0 && h > 0) add(custom.name.trim() || `s${w}x${h}`.replace(/[^a-z0-9]/g, '').slice(0, 16), [w, h]);
            }}
          >
            <input className="input" placeholder="名字" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} aria-label="新尺寸的名字" />
            <input className="input" placeholder="宽" value={custom.w} onChange={(e) => setCustom({ ...custom, w: e.target.value })} onKeyDown={(e) => e.stopPropagation()} aria-label="新尺寸的宽" />
            <input className="input" placeholder="高" value={custom.h} onChange={(e) => setCustom({ ...custom, h: e.target.value })} onKeyDown={(e) => e.stopPropagation()} aria-label="新尺寸的高" />
            <button className="btn outline" type="submit">
              添加
            </button>
          </form>
        </div>
      ) : (
        <button className="btn outline" onClick={() => setAdding(true)}>
          ＋ 添加尺寸
        </button>
      )}
      <p className="hint" style={{ margin: 0 }}>
        所有尺寸共用场景、文字和时间。新尺寸先按版式自己适配，再切到它把不合适的地方单独调。
      </p>
      <h3>快捷键</h3>
      <p className="hint" style={{ margin: 0 }}>
        空格 播放 / 暂停 · ← → 前后一帧（⇧ 一秒）· ⌫ 删除 · ⌘D 复制 · ⇧↵ 选中上一级 · ⌘Z 撤销 · Esc 取消选择
      </p>
    </div>
  );
}

/** The scene under the playhead: its layers, the ones off screen right now faded with when they show. */
export function MotionLayers() {
  const view = useStore((s) => s.motionView);
  const file = view?.scene ? `scenes/${view.scene}.html` : '';
  const source = useStore((s) => (file ? display(s, file) : undefined));
  const m = useMotion();
  const away = useMemo(
    () => (source && view ? awayAt(parsed(source), view.format, Object.keys(m.formats), view.at) : new Map<number, string>()),
    [source, view, m],
  );
  if (!file) return <div className="layers" />;
  return <SlideLayers file={file} away={away} />;
}
