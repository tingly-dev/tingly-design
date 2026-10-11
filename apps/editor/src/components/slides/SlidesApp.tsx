import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SLIDE_H, SLIDE_W, checkSlide, sectionsOf, slideFile, ICON_NAMES } from '@dc/core';
import { deckOf, display, editDeck, isSaving, parsed, slideIds, toast, useDeck, useSlideIds, useStore } from '../../store';
import {
  INSERTS,
  addSection,
  addSlide,
  deleteSlide,
  duplicateSlide,
  goToSlide,
  insertOnSlide,
  isHidden,
  moveSlide,
  notesOf,
  removeSection,
  renameSection,
  setNotes,
  slideTitle,
  toggleHidden,
  uploadImage,
} from '../../slides';
import { SlideFrame } from './SlideFrame';
import { Menu, MenuItem } from '../Menu';
import { RightPanel } from '../panel/RightPanel';
import { PromptBar } from '../PromptBar';
import { ContextMenu, JournalPopover } from '../Overlays';
import { Caret, Download, Panel, Picture, Play, Shapes, TextT } from '../icons';
import { exportDeck } from './exportDeck';

// ------------------------------------------------------------------ strip

const THUMB_W = 176;
const THUMB_K = THUMB_W / SLIDE_W;

function Thumb({ id, index }: { id: string; index: number }) {
  const current = useStore((s) => s.slide === id);
  const source = useStore((s) => display(s, slideFile(id)));
  const hidden = useMemo(() => (source ? isHidden(id) : false), [source, id]);
  const errors = useMemo(() => (source ? checkSlide(parsed(source), id).filter((i) => i.level === 'error').length : 0), [source, id]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  return (
    <div
      ref={ref}
      className={`thumb ${current ? 'on' : ''} ${hidden ? 'skipped' : ''} ${over ? 'over' : ''}`}
      role="option"
      aria-selected={current}
      aria-label={`第 ${index + 1} 页：${slideTitle(source, id)}`}
      data-slide={id}
      draggable
      onClick={() => goToSlide(id)}
      onContextMenu={(e) => {
        e.preventDefault();
        goToSlide(id);
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-slide', id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/x-slide')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const from = e.dataTransfer.getData('text/x-slide');
        if (from && from !== id) moveSlide(from, id);
      }}
    >
      <span className="num">{index + 1}</span>
      <div className="tframe">
        <SlideFrame id={id} scale={THUMB_K} use="thumb" />
        {hidden && <span className="tag">跳过</span>}
        {errors > 0 && (
          <span className="tag err" title={`${errors} 处不符合幻灯片格式`}>
            {errors}
          </span>
        )}
      </div>
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} label="幻灯片">
          <MenuItem label="在后面新建一页" onSelect={() => (setMenu(null), addSlide(id))} />
          <MenuItem label="复制这一页" onSelect={() => (setMenu(null), duplicateSlide(id))} />
          <MenuItem label={hidden ? '取消跳过' : '放映时跳过'} onSelect={() => (setMenu(null), toggleHidden(id))} />
          <MenuItem label="从这一页开始新的一节" onSelect={() => (setMenu(null), addSection(id))} />
          <hr />
          <MenuItem label="删除这一页" danger onSelect={() => (setMenu(null), void deleteSlide(id))} />
        </Menu>
      )}
    </div>
  );
}

function SectionHead({ k, description }: { k: string; description: string }) {
  const [editing, setEditing] = useState(false);
  if (!k) return null;
  return (
    <div className="shead">
      {editing ? (
        <input
          autoFocus
          defaultValue={description}
          aria-label="节的说明"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={(e) => {
            setEditing(false);
            const v = e.currentTarget.value.trim();
            if (v && v !== description) renameSection(k, v);
          }}
        />
      ) : (
        <span className="d" title="双击修改这一节的说明" onDoubleClick={() => setEditing(true)}>
          {description || '（未命名的一节）'}
        </span>
      )}
      <button className="ib" aria-label="删除这一节（保留幻灯片）" title="删除这一节（保留幻灯片）" onClick={() => removeSection(k)}>
        ×
      </button>
    </div>
  );
}

function Strip() {
  const deck = useDeck();
  const ids = useSlideIds();
  const groups = useMemo(() => sectionsOf(deck, ids), [deck, ids]);
  let n = 0;
  return (
    <aside className="strip" aria-label="幻灯片">
      <div className="slist" role="listbox" aria-label="幻灯片列表">
        {groups.map((g, gi) => (
          <div key={g.key || gi} className="sgroup">
            <SectionHead k={g.key} description={g.description} />
            {g.ids.map((id) => (
              <Thumb key={id} id={id} index={n++} />
            ))}
          </div>
        ))}
        <div
          className="sdrop"
          onDragOver={(e) => e.dataTransfer.types.includes('text/x-slide') && e.preventDefault()}
          onDrop={(e) => {
            const from = e.dataTransfer.getData('text/x-slide');
            if (from) moveSlide(from, null);
          }}
        />
      </div>
      <button className="btn outline addslide" onClick={() => addSlide()}>
        + 新建幻灯片
      </button>
    </aside>
  );
}

// ---------------------------------------------------------------- toolbar

const SHAPES: [string, string][] = [
  ['rect', '矩形'],
  ['rounded', '圆角矩形'],
  ['ellipse', '椭圆'],
  ['diamond', '菱形'],
  ['arrow-right', '向右箭头'],
  ['arrow-left', '向左箭头'],
  ['arrow-up', '向上箭头'],
  ['arrow-down', '向下箭头'],
  ['line', '直线'],
];

function TopLeft() {
  const deck = useDeck();
  const [menu, setMenu] = useState<null | 'shapes' | 'icons'>(null);
  const [renaming, setRenaming] = useState(false);
  const shapesBtn = useRef<HTMLButtonElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const at = (b: HTMLElement | null) => {
    const r = b?.getBoundingClientRect();
    return { x: r?.left ?? 0, y: (r?.bottom ?? 0) + 8 };
  };
  return (
    <div className="bar left" role="toolbar" aria-label="插入">
      {renaming ? (
        <input
          className="dtitle"
          autoFocus
          defaultValue={deck.title}
          aria-label="幻灯片名称"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
          onBlur={(e) => {
            setRenaming(false);
            const v = e.currentTarget.value.trim();
            if (v && v !== deck.title) editDeck((d) => (d.title = v), `title → ${v}`);
          }}
        />
      ) : (
        <button className="tb text dtitle" title="双击改名" onDoubleClick={() => setRenaming(true)}>
          {deck.title}
        </button>
      )}
      <span className="sep" />
      <button className="tb" aria-label="插入文字" title="插入文字" onClick={() => insertOnSlide(INSERTS.text, true)}>
        <TextT />
      </button>
      <button className="tb" aria-label="插入图片" title="插入图片" onClick={() => file.current?.click()}>
        <Picture />
      </button>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) void uploadImage(f);
        }}
      />
      <button className="tb" aria-label="插入表格" title="插入表格" onClick={() => insertOnSlide(INSERTS.table, false)}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="3" y="4" width="14" height="12" rx="1.5" />
          <path d="M3 8h14M3 12h14M8 4v12" />
        </svg>
      </button>
      <button ref={shapesBtn} className="tb" aria-haspopup="menu" aria-label="形状、连线和图标" title="形状、连线和图标" onClick={() => setMenu('shapes')}>
        <Shapes />
        <span className="caret">
          <Caret />
        </span>
      </button>
      {menu === 'shapes' && (
        <Menu {...at(shapesBtn.current)} onClose={() => setMenu(null)} label="形状">
          {SHAPES.map(([k, l]) => (
            <MenuItem key={k} label={l} onSelect={() => (setMenu(null), insertOnSlide(INSERTS.shape(k), true))} />
          ))}
          <hr />
          <MenuItem label="连线（箭头）" onSelect={() => (setMenu(null), insertOnSlide(INSERTS.connector, true))} />
          <MenuItem label="图标…" onSelect={() => setMenu('icons')} />
        </Menu>
      )}
      {menu === 'icons' && (
        <Menu {...at(shapesBtn.current)} onClose={() => setMenu(null)} label="图标">
          <div className="iconpick">
            {ICON_NAMES.map((n) => (
              <button key={n} className="tb" title={n} onClick={() => (setMenu(null), insertOnSlide(INSERTS.icon(n), true))}>
                {n}
              </button>
            ))}
          </div>
        </Menu>
      )}
    </div>
  );
}

function TopRight() {
  const panelOpen = useStore((s) => s.panelOpen);
  const connected = useStore((s) => s.connected);
  const saving = useStore(isSaving);
  const journalOpen = useStore((s) => s.journalOpen);
  const [menu, setMenu] = useState<null | 'play' | 'download'>(null);
  const playBtn = useRef<HTMLButtonElement>(null);
  const dlBtn = useRef<HTMLButtonElement>(null);
  const at = (b: HTMLElement | null) => {
    const r = b?.getBoundingClientRect();
    return { x: r?.right ?? 0, y: (r?.bottom ?? 0) + 8, align: 'right' as const };
  };
  return (
    <div className="bar right" role="toolbar" aria-label="幻灯片">
      <button ref={playBtn} className="tb text" aria-haspopup="menu" aria-label="放映" onClick={() => setMenu('play')}>
        <Play /> 放映
        <span className="caret">
          <Caret />
        </span>
      </button>
      <button ref={dlBtn} className="tb" aria-haspopup="menu" aria-label="下载" title="下载" onClick={() => setMenu('download')}>
        <Download />
      </button>
      <button className="tb" aria-pressed={panelOpen} aria-label="属性面板" title="属性面板（⌘\）" onClick={() => useStore.setState({ panelOpen: !panelOpen })}>
        <Panel />
      </button>
      <span className="sep" />
      <button className="tb" aria-pressed={journalOpen} aria-label="同步状态和改动记录" onClick={() => useStore.setState({ journalOpen: !journalOpen })}>
        <span className="sync">
          <span className={`dot ${!connected ? 'off' : saving ? 'busy' : ''}`} />
          {!connected ? '未连接' : saving ? '保存中' : '已同步'}
        </span>
      </button>
      {menu === 'play' && (
        <Menu {...at(playBtn.current)} onClose={() => setMenu(null)} label="放映">
          <MenuItem label="从头放映" onSelect={() => (setMenu(null), startPresent(0))} />
          <MenuItem label="从当前页放映" onSelect={() => (setMenu(null), startPresent(null))} />
          <MenuItem label="放映并显示演讲者备注" onSelect={() => (setMenu(null), startPresent(null, true))} />
        </Menu>
      )}
      {menu === 'download' && (
        <Menu {...at(dlBtn.current)} onClose={() => setMenu(null)} label="下载">
          <MenuItem label="PDF（打印）" onSelect={() => (setMenu(null), void exportDeck('pdf'))} />
          <MenuItem label="单个 HTML 文件" onSelect={() => (setMenu(null), void exportDeck('html'))} />
          <MenuItem label="演讲者备注（.txt）" onSelect={() => (setMenu(null), void exportDeck('notes'))} />
        </Menu>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ stage

function useFit(ref: React.RefObject<HTMLElement | null>, padX: number, padY: number): number {
  const [k, setK] = useState(0.4);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - padX * 2;
      const h = el.clientHeight - padY * 2;
      setK(Math.max(0.1, Math.min(w / SLIDE_W, h / SLIDE_H)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, padX, padY]);
  return k;
}

function Notes({ id }: { id: string }) {
  const source = useStore((s) => display(s, slideFile(id)));
  const saved = notesOf(source);
  const [text, setText] = useState(saved);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!focused.current) setText(saved);
  }, [saved]);
  // save as you type (a click on the slide never blurs this box: the frame keeps focus where it is)
  const save = (t: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (t !== notesOf(display(useStore.getState(), slideFile(id)))) setNotes(id, t);
    }, 700);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <textarea
      className="snotes"
      value={text}
      placeholder="演讲者备注（只在放映的备注窗口里出现）"
      aria-label="演讲者备注"
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        setText(e.target.value);
        save(e.target.value);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onBlur={() => {
        focused.current = false;
      }}
    />
  );
}

function Issues({ id }: { id: string }) {
  const source = useStore((s) => display(s, slideFile(id)));
  const issues = useMemo(() => (source ? checkSlide(parsed(source), id).filter((i) => i.level !== 'note') : []), [source, id]);
  const [open, setOpen] = useState(false);
  if (!issues.length) return null;
  const errors = issues.filter((i) => i.level === 'error').length;
  return (
    <div className={`issues ${errors ? 'err' : ''}`}>
      <button className="ibtn" onClick={() => setOpen(!open)} aria-expanded={open}>
        {errors ? `${errors} 处超出幻灯片格式` : `${issues.length} 处提示`}
      </button>
      {open && (
        <ul>
          {issues.map((i, n) => (
            <li
              key={n}
              className={i.level}
              onClick={() => i.tid !== null && useStore.setState({ selection: { kind: 'el', file: slideFile(id), tid: i.tid } })}
            >
              {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stage() {
  const id = useStore((s) => s.slide);
  const area = useRef<HTMLDivElement>(null);
  const k = useFit(area, 40, 40);
  const error = useStore((s) => (id ? s.runtimeErrors[slideFile(id)] : null));
  return (
    <div className="sarea" ref={area} onPointerDown={(e) => e.target === e.currentTarget && useStore.setState({ selection: null })}>
      {id ? (
        <div className="scol">
          <div className="shead2">
            <Issues id={id} />
            {error && (
              <span className="badge err" title={error}>
                出错
              </span>
            )}
          </div>
          <SlideFrame id={id} scale={k} use="stage" />
          <Notes key={id} id={id} />
        </div>
      ) : (
        <div className="empty">没有幻灯片。点左下角“新建幻灯片”。</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- present

export function startPresent(from: number | null, notes = false): void {
  const s = useStore.getState();
  const ids = slideIds(s).filter((id) => !isHidden(id));
  if (!ids.length) return toast('没有可以放映的幻灯片。');
  const i = from ?? Math.max(0, ids.indexOf(s.slide ?? ''));
  useStore.setState({ present: { index: i, step: 0, total: 0, leaving: null, notes }, mode: 'play', selection: null, menu: null });
  document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
}

export function stopPresent(): void {
  useStore.setState({ present: null, mode: 'edit' });
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

/** Next build, else next slide. Returns false at the end. */
export function presentStep(dir: 1 | -1): void {
  const s = useStore.getState();
  const p = s.present;
  if (!p) return;
  const ids = slideIds(s).filter((id) => !isHidden(id));
  if (dir > 0 && p.step < buildCount(ids[p.index])) return useStore.setState({ present: { ...p, step: p.step + 1 } });
  const next = p.index + dir;
  if (next < 0) return;
  if (next >= ids.length) return stopPresent();
  useStore.setState({ present: { ...p, index: next, step: 0, total: 0, leaving: { index: p.index, dir } } });
}

/** Click steps a slide's builds take: every build that is not `auto` (known from the source, before its frame loads). */
function buildCount(id: string | undefined): number {
  const src = id ? display(useStore.getState(), slideFile(id)) : undefined;
  if (!src) return 0;
  return parsed(src).elements.filter((e) => {
    const b = e.attrs.find((a) => a.name === 'data-build-in')?.value;
    return b !== undefined && !/\bauto\b/.test(b);
  }).length;
}

function transitionOf(id: string | undefined): string {
  if (!id) return 'none';
  const src = display(useStore.getState(), slideFile(id));
  const root = src ? parsed(src).elements[0] : undefined;
  return root?.attrs.find((a) => a.name === 'data-transition')?.value ?? 'none';
}

function Present() {
  const p = useStore((s) => s.present)!;
  const ids = useStore((s) => slideIds(s)).filter((id) => !isHidden(id));
  const box = useRef<HTMLDivElement>(null);
  const k = useFit(box, 0, 0);
  const id = ids[p.index];
  const leaving = p.leaving ? ids[p.leaving.index] : undefined;
  // the slide being left decides how it leaves
  const tr = p.leaving ? transitionOf(p.leaving.dir > 0 ? leaving : id) : 'none';
  useEffect(() => {
    if (!p.leaving) return;
    const t = setTimeout(() => useStore.setState((s) => (s.present ? { present: { ...s.present, leaving: null } } : {})), 650);
    return () => clearTimeout(t);
  }, [p.leaving]);
  const source = useStore((s) => (id ? display(s, slideFile(id)) : undefined));
  return (
    <div className={`present ${p.notes ? 'withnotes' : ''}`} role="dialog" aria-label="放映">
      <div className="pstage" ref={box}>
        {leaving && p.leaving && (
          <div key={'out' + leaving} className={`pslide out t-${tr} d${p.leaving.dir > 0 ? 'f' : 'b'}`}>
            <SlideFrame id={leaving} scale={k} use="present" step={99} />
          </div>
        )}
        {id && (
          <div key={id} className={`pslide in ${p.leaving ? `t-${tr} d${p.leaving.dir > 0 ? 'f' : 'b'}` : ''}`}>
            <SlideFrame
              id={id}
              scale={k}
              use="present"
              step={p.step}
              onSteps={(total) => useStore.setState((s) => (s.present && s.present.total !== total ? { present: { ...s.present, total } } : {}))}
            />
          </div>
        )}
      </div>
      {p.notes && (
        <aside className="pnotes" aria-label="演讲者备注">
          <div className="pn-h">
            演讲者备注 · {p.index + 1} / {ids.length}
          </div>
          <div className="pn-b">{notesOf(source) || '（这一页没有备注）'}</div>
        </aside>
      )}
      <div className="pbar">
        <button className="tb" onClick={() => presentStep(-1)} aria-label="上一页">
          ‹
        </button>
        <span>
          {p.index + 1} / {ids.length}
        </span>
        <button className="tb" onClick={() => presentStep(1)} aria-label="下一页">
          ›
        </button>
        <button className="tb" onClick={() => useStore.setState({ present: { ...p, notes: !p.notes } })} aria-pressed={p.notes}>
          备注
        </button>
        <button className="tb" onClick={stopPresent}>
          退出
        </button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- app

export function SlidesApp() {
  const loaded = useStore((s) => s.loaded);
  const panelOpen = useStore((s) => s.panelOpen);
  const present = useStore((s) => !!s.present);
  const slide = useStore((s) => s.slide);
  const ids = useSlideIds();

  // keep the stage on a slide that exists (another editor may delete it)
  useEffect(() => {
    if (!loaded) return;
    if (!slide || !ids.includes(slide)) goToSlide(ids[0] ?? null);
  }, [loaded, slide, ids]);

  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement && useStore.getState().present) stopPresent();
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    const t = deckOf(useStore.getState()).title;
    if (t) document.title = `${t} · 幻灯片`;
  });

  return (
    <div className="app slides" data-mode={present ? 'play' : 'edit'}>
      <Strip />
      <main className="stage">
        <TopLeft />
        <TopRight />
        <Stage />
        {loaded && !present && <PromptBar />}
        <JournalPopover />
      </main>
      {panelOpen && !present && <RightPanel />}
      <ContextMenu />
      {present && <Present />}
    </div>
  );
}
