import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
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
import { api, type GitState } from '../api';
import { canvasOf, display, toast, useCanvas, useStore } from '../store';
import { getClip } from '../clipboard';
import { TEXT_COLORS, sizeOf } from './canvas/Item';
import { copyPng } from './canvas/Board';
import { Menu, MenuItem } from './Menu';
import { Close } from './icons';
import { SERVER } from '../base';
import { currentLanguage, htmlLang } from '../i18n';
import { Dialog } from './Dialog';

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

// ---------------------------------------------------------------- context menu

export function ContextMenu() {
  const { t } = useTranslation();
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
    <Menu x={menu.x} y={menu.y} onClose={close} label={t('common.edit')}>
      <MenuItem label={t('canvas.menu.cut')} keys={`${mod}X`} disabled={isRoot || sel.kind === 'board'} onSelect={run(cutSelection)} />
      <MenuItem label={t('common.copy')} keys={`${mod}C`} disabled={sel.kind === 'board'} onSelect={run(copySelection)} />
      <MenuItem label={t('canvas.menu.copyPng')} disabled={sel.kind === 'note'} onSelect={run(() => sel.kind !== 'note' && void copyPng(sel.file, sel.kind === 'el' ? sel.tid : undefined))} />
      <MenuItem label={t('canvas.menu.paste')} keys={`${mod}V`} disabled={!clip} onSelect={run(paste)} />
      <MenuItem label={t('canvas.menu.duplicate')} keys={`${mod}D`} disabled={isRoot} onSelect={run(duplicateSelection)} />
      <hr />
      <MenuItem label={t('canvas.menu.toLast')} keys="]" disabled={isRoot} onSelect={run(() => orderSelection('last'))} />
      <MenuItem label={t('canvas.menu.toFirst')} keys="[" disabled={isRoot} onSelect={run(() => orderSelection('first'))} />
      {sel.kind === 'el' && (
        <>
          <hr />
          <MenuItem label={t('canvas.menu.group')} keys={`${mod}G`} disabled={isRoot} onSelect={run(() => wrapSelection('group'))} />
          <MenuItem label={t('canvas.menu.ungroup')} keys={`⇧${mod}G`} disabled={isRoot || !hasKids} onSelect={run(ungroupSelection)} />
          <MenuItem label={t('canvas.menu.flipH')} keys="⇧H" onSelect={run(() => flipSelection('x'))} />
          <MenuItem label={t('canvas.menu.flipV')} keys="⇧V" onSelect={run(() => flipSelection('y'))} />
          <hr />
          <MenuItem label={t('canvas.menu.wrapFlex')} keys="⇧A" disabled={isRoot} onSelect={run(() => wrapSelection('flex'))} />
          <MenuItem label={t('canvas.menu.wrapGrid')} disabled={isRoot} onSelect={run(() => wrapSelection('grid'))} />
        </>
      )}
      {sel.kind === 'note' && (
        <>
          <hr />
          <MenuItem label={t('canvas.menu.flipH')} keys="⇧H" onSelect={run(() => flipSelection('x'))} />
          <MenuItem label={t('canvas.menu.flipV')} keys="⇧V" onSelect={run(() => flipSelection('y'))} />
        </>
      )}
      <hr />
      <MenuItem label={sel.kind === 'board' ? t('canvas.menu.deleteBoard') : t('common.delete')} keys="⌫" danger disabled={isRoot} onSelect={run(() => deleteSelection())} />
    </Menu>
  );
}

// ---------------------------------------------------------------- note format bar

/** Floats above a selected sticky note or title, like the original's. */
export function NoteFormatBar() {
  const { t } = useTranslation();
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
    <div className="fmt" style={{ left: Math.max(8, left), top: Math.max(56, top) }} role="toolbar" aria-label={t('canvas.format.label')} onPointerDown={(e) => e.stopPropagation()}>
      <select aria-label={t('canvas.format.size')} value={sizeKey} onChange={(e) => up({ size: NOTE_SIZES[e.currentTarget.value as keyof typeof NOTE_SIZES] }, 'size')}>
        {!sizeKey && <option value="">{size}px</option>}
        {Object.entries(NOTE_SIZES).map(([k, v]) => (
          <option key={k} value={k}>
            {t(`canvas.format.sizes.${k as keyof typeof NOTE_SIZES}`)} {v}
          </option>
        ))}
      </select>
      <button className="ib" title={t('canvas.format.bold')} aria-label={t('canvas.format.bold')} aria-pressed={n.kind === 'title1' ? n.bold !== false : !!n.bold} onClick={() => up({ bold: n.kind === 'title1' ? n.bold === false : !n.bold }, 'bold')}>
        <b>B</b>
      </button>
      <button className="ib" title={t('canvas.format.italic')} aria-label={t('canvas.format.italic')} aria-pressed={!!n.italic} onClick={() => up({ italic: !n.italic }, 'italic')}>
        <i>I</i>
      </button>
      <button className="ib" title={t('canvas.format.list')} aria-label={t('canvas.format.list')} onClick={() => up({ text: (n.text ?? '').split('\n').map((l) => (l.startsWith('- ') ? l.slice(2) : '- ' + l)).join('\n') }, 'list')}>
        ≡
      </button>
      <span className="sep" style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 2px' }} />
      {(['default', 'red', 'blue', 'green'] as const).map((c) => (
        <button key={c} className="ib" title={t('canvas.format.textColor')} aria-label={t('canvas.format.textColorLabel', { color: c })} aria-pressed={(n.color ?? 'default') === c} onClick={() => up({ color: c === 'default' ? undefined : c }, 'color')}>
          <span className="sw" style={{ background: TEXT_COLORS[c] }} />
        </button>
      ))}
      {!n.kind && (
        <>
          <span className="sep" style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 2px' }} />
          {(['default', 'green', 'blue', 'pink', 'gray'] as const).map((f) => (
            <button key={f} className="ib" title={t('canvas.format.fill')} aria-label={t('canvas.format.fillLabel', { color: f })} aria-pressed={(n.fill ?? 'default') === f} onClick={() => up({ fill: f === 'default' ? undefined : f }, 'fill')}>
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
  const { t } = useTranslation();
  const file = useStore((s) => s.focused);
  const source = useStore((s) => (s.focused ? display(s, s.focused) : undefined));
  const canvas = useCanvas();
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const srcdoc = useMemo(() => sandboxDoc(SERVER, 'runtime', htmlLang()), []);
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
    <div className="focus" role="dialog" aria-label={t('canvas.focus.label', { title: b.title ?? file })}>
      <header>
        <span className="t">{b.title ?? file}</span>
        <span style={{ opacity: 0.6 }}>
          {i + 1} / {order.length}
        </span>
        <span style={{ flex: 1 }} />
        <button className="tb" disabled={i <= 0} onClick={() => useStore.setState({ focused: order[i - 1] })} aria-label={t('canvas.focus.prev')}>
          ←
        </button>
        <button className="tb" disabled={i >= order.length - 1} onClick={() => useStore.setState({ focused: order[i + 1] })} aria-label={t('canvas.focus.next')}>
          →
        </button>
        <button className="tb" onClick={() => useStore.setState({ focused: null })} aria-label={t('canvas.focus.exit')}>
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
  const locale = currentLanguage() === 'zh' ? 'zh-CN' : currentLanguage();
  return new Date().toDateString() === d.toDateString()
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : d.toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Committing, said before it happens: which repository and branch the commit lands on, or that the
 * project has none yet and confirming gives it one of its own in its folder. One confirmation, no
 * separate "create a repository" step (.design/project-git.md).
 */
function CommitDialog({ project, onClose }: { project: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [state, setState] = useState<GitState | null>(null);
  const [message, setMessage] = useState(`design(${project}): update`);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api.git(project).then(
      (g) => live && setState(g),
      (e: Error) => (toast(e.message, 'error'), onClose()),
    );
    return () => {
      live = false;
    };
  }, [project, onClose]);
  const fresh = !!state && !state.repo;
  const nothing = !!state && !!state.repo && state.changes === 0;
  const submit = async () => {
    if (!state || busy || nothing || !message.trim()) return;
    setBusy(true);
    const r = await api.commit(project, message.trim(), fresh).catch((e: Error) => ({ ok: false, output: e.message }));
    toast(r.output, r.ok ? 'info' : 'error');
    onClose();
  };
  return (
    <Dialog label={t('canvas.journal.commit')} className="lcommit" onClose={onClose} onSubmit={() => void submit()}>
      <div className="commit-where" role="status" data-state={!state ? 'checking' : fresh ? 'new' : 'repo'}>
        {!state
          ? t('canvas.journal.commitChecking')
          : fresh
            ? t('canvas.journal.commitNew', { folder: state.folder })
            : state.branch
              ? t('canvas.journal.commitTo', { repo: state.repo, branch: state.branch })
              : t('canvas.journal.commitToDetached', { repo: state.repo })}
        {state && !fresh && <span className="commit-changes">{nothing ? t('canvas.journal.commitNothing') : t('canvas.journal.commitChanges', { count: state.changes })}</span>}
      </div>
      <input autoFocus className="input" aria-label={t('canvas.journal.commitPrompt')} placeholder={t('canvas.journal.commitPrompt')} value={message} onChange={(e) => setMessage(e.target.value)} />
      <footer>
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="btn primary" type="submit" disabled={!state || busy || nothing || !message.trim()}>
          {fresh ? t('canvas.journal.commitCreate') : t('canvas.journal.commitDo')}
        </button>
      </footer>
    </Dialog>
  );
}

export function JournalPopover() {
  const { t } = useTranslation();
  const open = useStore((s) => s.journalOpen);
  const journal = useStore((s) => s.journal);
  const project = useStore((s) => s.project);
  const [committing, setCommitting] = useState(false);
  const closeCommit = useMemo(() => () => setCommitting(false), []);
  // the dialog outlives the popover: a click in it counts as outside the popover, which closes it
  const dialog = committing && project && createPortal(<CommitDialog project={project} onClose={closeCommit} />, document.body);
  if (!open) return dialog || null;
  return (
    <section className="journal-pop" aria-label={t('canvas.journal.title')}>
      {dialog}
      <header>
        {t('canvas.journal.title')}
        <button className="btn" title={t('canvas.journal.commitHint')} data-commit="" onClick={() => setCommitting(true)}>
          {t('canvas.journal.commit')}
        </button>
        <button className="ib" aria-label={t('common.close')} onClick={() => useStore.setState({ journalOpen: false })}>
          <Close />
        </button>
      </header>
      <p className="jhelp">
        <b>{t('canvas.journal.undoTitle')}</b> {t('canvas.journal.undoHelp')}
        <br />
        <b>{t('canvas.journal.lineTitle')}</b> {t('canvas.journal.lineHelp')}
        <br />
        <b>{t('canvas.journal.commitTitle')}</b> {t('canvas.journal.commitHint')}
      </p>
      <div className="journal" aria-live="polite">
        {!journal.length && <div className="empty">{t('canvas.journal.empty')}</div>}
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

