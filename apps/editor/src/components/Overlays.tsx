import { useEffect, useMemo, useRef, useState } from 'react';
import { NOTE_SIZES, isShape, sandboxDoc, type FromRuntime, type ToRuntime } from '@dc/core';
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  flipSelection,
  orderSelection,
  paste,
  selectedElement,
  ungroupSelection,
  updateNote,
  wrapSelection,
} from '../actions';
import { api } from '../api';
import { canvasOf, display, getClip, toast, useCanvas, useStore } from '../store';
import { TEXT_COLORS, sizeOf } from './Item';
import { Menu, MenuItem } from './Menu';
import { Close } from './icons';
import { SERVER } from '../base';
import { t } from '../i18n';

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

// ---------------------------------------------------------------- context menu

export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const sel = useStore((s) => s.selection);
  if (!menu || !sel) return null;
  const close = () => useStore.setState({ menu: null });
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  const el = sel.kind === 'el' ? selectedElement() : null;
  const isRoot = !!el && !el.el.parent;
  const hasKids = !!el?.el.children.some((c) => c.kind === 'el');
  const clip = getClip();
  return (
    <Menu x={menu.x} y={menu.y} onClose={close} label="编辑">
      <MenuItem label="剪切" keys={`${mod}X`} disabled={isRoot || sel.kind === 'board'} onSelect={run(cutSelection)} />
      <MenuItem label="复制" keys={`${mod}C`} disabled={sel.kind === 'board'} onSelect={run(copySelection)} />
      <MenuItem label="粘贴" keys={`${mod}V`} disabled={!clip} onSelect={run(paste)} />
      <MenuItem label="创建副本" keys={`${mod}D`} disabled={isRoot} onSelect={run(duplicateSelection)} />
      <hr />
      <MenuItem label="移到最后" keys="]" disabled={isRoot} onSelect={run(() => orderSelection('last'))} />
      <MenuItem label="移到最前" keys="[" disabled={isRoot} onSelect={run(() => orderSelection('first'))} />
      {sel.kind === 'el' && (
        <>
          <hr />
          <MenuItem label="编组" keys={`${mod}G`} disabled={isRoot} onSelect={run(() => wrapSelection('group'))} />
          <MenuItem label="取消编组" keys={`⇧${mod}G`} disabled={isRoot || !hasKids} onSelect={run(ungroupSelection)} />
          <MenuItem label="水平翻转" keys="⇧H" onSelect={run(() => flipSelection('x'))} />
          <MenuItem label="垂直翻转" keys="⇧V" onSelect={run(() => flipSelection('y'))} />
          <hr />
          <MenuItem label="包进 flex 容器" keys="⇧A" disabled={isRoot} onSelect={run(() => wrapSelection('flex'))} />
          <MenuItem label="包进 grid 容器" disabled={isRoot} onSelect={run(() => wrapSelection('grid'))} />
        </>
      )}
      {sel.kind === 'note' && (
        <>
          <hr />
          <MenuItem label="水平翻转" keys="⇧H" onSelect={run(() => flipSelection('x'))} />
          <MenuItem label="垂直翻转" keys="⇧V" onSelect={run(() => flipSelection('y'))} />
        </>
      )}
      <hr />
      <MenuItem label={sel.kind === 'board' ? '删除画板' : '删除'} keys="⌫" danger disabled={isRoot} onSelect={run(() => deleteSelection())} />
    </Menu>
  );
}

// ---------------------------------------------------------------- note format bar

/** Floats above a selected sticky note or title, like the original's. */
export function NoteFormatBar() {
  const sel = useStore((s) => s.selection);
  const view = useStore((s) => s.view);
  const canvas = useCanvas();
  const stage = document.querySelector('.stage')?.getBoundingClientRect();
  if (sel?.kind !== 'note' || !stage) return null;
  const n = canvas.notes[sel.id];
  if (!n || isShape(n)) return null;
  const left = stage.left + view.x + n.x * view.zoom;
  const top = stage.top + view.y + n.y * view.zoom - 46;
  const size = sizeOf(n);
  const sizeKey = Object.entries(NOTE_SIZES).find(([, v]) => v === size)?.[0] ?? '';
  const up = (p: Parameters<typeof updateNote>[1], what: string) => updateNote(sel.id, p, what);
  return (
    <div className="fmt" style={{ left: Math.max(8, left), top: Math.max(56, top) }} role="toolbar" aria-label="便签格式" onPointerDown={(e) => e.stopPropagation()}>
      <select aria-label="字号" value={sizeKey} onChange={(e) => up({ size: NOTE_SIZES[e.currentTarget.value as keyof typeof NOTE_SIZES] }, 'size')}>
        {!sizeKey && <option value="">{size}px</option>}
        {Object.entries(NOTE_SIZES).map(([k, v]) => (
          <option key={k} value={k}>
            {{ s: '小', m: '中', l: '大', xl: '特大', xxl: '巨大' }[k]} {v}
          </option>
        ))}
      </select>
      <button className="ib" title="粗体" aria-label="粗体" aria-pressed={n.kind === 'title1' ? n.bold !== false : !!n.bold} onClick={() => up({ bold: n.kind === 'title1' ? n.bold === false : !n.bold }, 'bold')}>
        <b>B</b>
      </button>
      <button className="ib" title="斜体" aria-label="斜体" aria-pressed={!!n.italic} onClick={() => up({ italic: !n.italic }, 'italic')}>
        <i>I</i>
      </button>
      <button className="ib" title="列表" aria-label="列表" onClick={() => up({ text: (n.text ?? '').split('\n').map((l) => (l.startsWith('- ') ? l.slice(2) : '- ' + l)).join('\n') }, 'list')}>
        ≡
      </button>
      <span className="sep" style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 2px' }} />
      {(['default', 'red', 'blue', 'green'] as const).map((c) => (
        <button key={c} className="ib" title={`文字颜色`} aria-label={`文字颜色 ${c}`} aria-pressed={(n.color ?? 'default') === c} onClick={() => up({ color: c === 'default' ? undefined : c }, 'color')}>
          <span className="sw" style={{ background: TEXT_COLORS[c] }} />
        </button>
      ))}
      {!n.kind && (
        <>
          <span className="sep" style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 2px' }} />
          {(['default', 'green', 'blue', 'pink', 'gray'] as const).map((f) => (
            <button key={f} className="ib" title="底色" aria-label={`底色 ${f}`} aria-pressed={(n.fill ?? 'default') === f} onClick={() => up({ fill: f === 'default' ? undefined : f }, 'fill')}>
              <span className="sw" style={{ background: `var(--note-${f})` }} />
            </button>
          ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- full window

/** One artboard, full window, running (play mode). Arrows step through artboards. */
export function FocusView() {
  const file = useStore((s) => s.focused);
  const source = useStore((s) => (s.focused ? display(s, s.focused) : undefined));
  const canvas = useCanvas();
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const srcdoc = useMemo(() => sandboxDoc(SERVER, 'runtime'), []);
  const order = canvas.order;
  const b = file ? canvas.boards[file] : undefined;

  useEffect(() => {
    if (!file) return;
    setReady(false);
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const m = e.data as FromRuntime;
      if (m?.dc === 'ready') setReady(true);
      if (m?.dc === 'navigate') {
        const href = m.href.split('#')[0].replace(/^\//, '');
        if (canvasOf(useStore.getState()).boards[href]) useStore.setState({ focused: href });
      }
      if (m?.dc === 'key' && m.key === 'Escape') useStore.setState({ focused: null });
    };
    window.addEventListener('message', onMsg);
    const ro = new ResizeObserver(() => box.current && setSize({ w: box.current.clientWidth, h: box.current.clientHeight }));
    if (box.current) ro.observe(box.current);
    return () => {
      window.removeEventListener('message', onMsg);
      ro.disconnect();
    };
  }, [file]);

  useEffect(() => {
    if (!ready || !file || source === undefined) return;
    const project = useStore.getState().project;
    const msg: ToRuntime = { dc: 'render', file, source, files: {}, props: {}, mode: 'play', selected: null, base: project ? api.rawBase(project) : undefined };
    frame.current?.contentWindow?.postMessage(msg, '*');
  }, [ready, file, source]);

  useEffect(() => {
    if (!file) return;
    const key = (e: KeyboardEvent) => {
      const i = order.indexOf(file);
      if (e.key === 'Escape') useStore.setState({ focused: null });
      else if (e.key === 'ArrowRight' && i < order.length - 1) useStore.setState({ focused: order[i + 1] });
      else if (e.key === 'ArrowLeft' && i > 0) useStore.setState({ focused: order[i - 1] });
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [file, order]);

  if (!file || !b) return null;
  const fill = b.expand === 'fill';
  const scale = fill ? 1 : Math.min(1, (size.w - 48) / b.w, (size.h - 48) / b.h) || 1;
  const w = fill ? size.w : b.w;
  const h = fill ? Math.max(size.h, b.h) : b.h;
  const i = order.indexOf(file);
  return (
    <div className="focus" role="dialog" aria-label={`全屏：${b.title ?? file}`}>
      <header>
        <span className="t">{b.title ?? file}</span>
        <span style={{ opacity: 0.6 }}>
          {i + 1} / {order.length}
        </span>
        <span style={{ flex: 1 }} />
        <button className="tb" disabled={i <= 0} onClick={() => useStore.setState({ focused: order[i - 1] })} aria-label="上一个画板">
          ←
        </button>
        <button className="tb" disabled={i >= order.length - 1} onClick={() => useStore.setState({ focused: order[i + 1] })} aria-label="下一个画板">
          →
        </button>
        <button className="tb" onClick={() => useStore.setState({ focused: null })} aria-label="退出全屏">
          <Close />
        </button>
      </header>
      <div className="viewport" ref={box}>
        <div style={{ width: w * scale, height: h * scale }}>
          <iframe key={file} ref={frame} title={b.title ?? file} sandbox="allow-scripts allow-popups" srcDoc={srcdoc} style={{ width: w, height: h, transform: `scale(${scale})` }} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- journal

function time(iso: string): string {
  const d = new Date(iso);
  return new Date().toDateString() === d.toDateString()
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function JournalPopover() {
  const open = useStore((s) => s.journalOpen);
  const journal = useStore((s) => s.journal);
  const project = useStore((s) => s.project);
  if (!open) return null;
  const commit = async () => {
    if (!project) return;
    const msg = prompt('提交说明', `canvas(${project}): ${canvasOf(useStore.getState()).title}`);
    if (msg === null) return;
    const r = await api.commit(project, msg);
    toast(r.output, r.ok ? 'info' : 'error');
  };
  return (
    <section className="journal-pop" aria-label="改动记录">
      <header>
        改动记录
        <button className="btn" onClick={commit}>
          提交到 git
        </button>
        <button className="ib" aria-label="关闭" onClick={() => useStore.setState({ journalOpen: false })}>
          <Close />
        </button>
      </header>
      <div className="journal" aria-live="polite">
        {!journal.length && <div className="empty">每次改动都会记在这里：谁改的（手改、快速 AI、Claude Code、外部编辑）、改了哪个画板、改了什么。</div>}
        {[...journal].reverse().map((j) => (
          <div className="jline" key={j.id}>
            <div className="bar2" style={{ background: `var(--actor-${j.actor})` }} />
            <div>
              <div className="who">
                <b style={{ color: `var(--actor-${j.actor})` }}>{t(`app.actor.${j.actor}`)}</b>
                <span>{j.file}</span>
                <span style={{ marginLeft: 'auto' }}>{time(j.at)}</span>
              </div>
              <div className="what">{j.summary}</div>
              {j.prompt && <div className="asked">“{j.prompt.length > 120 ? j.prompt.slice(0, 119) + '…' : j.prompt}”</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

