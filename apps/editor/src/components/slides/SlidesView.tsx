import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ICON_NAMES, SHAPE_KINDS, SLIDE_H, SLIDE_W, sectionRuns, slideFile, slideNotes, slideTitle } from '@dc/core';
import { display, goToSlide, isSaving, slidesOf, useDeck, useSlides, useStore } from '../../store';
import {
  INSERT,
  addSlide,
  deleteSlide,
  describeSection,
  duplicateSlide,
  insertImageFile,
  isSkipped,
  moveSlide,
  removeSection,
  renameDeck,
  setCover,
  setNotes,
  startSection,
  toggleSkip,
} from '../../deck';
import { exportBoard } from '../Board';
import { Menu, MenuItem } from '../Menu';
import { Caret, Download, GridI, ImageI, NotesI, Panel, Plus, Present, RailI, Shapes, SlideI, Star, TableI, TextT } from '../icons';
import { SlideFrame } from './SlideFrame';
import { startPresenting } from './Presenter';

const SHAPE_LABEL: Record<string, string> = {
  rect: '矩形',
  rounded: '圆角矩形',
  ellipse: '椭圆',
  diamond: '菱形',
  'arrow-right': '右箭头',
  'arrow-left': '左箭头',
  'arrow-up': '上箭头',
  'arrow-down': '下箭头',
  line: '直线',
};

function at(b: HTMLElement | null, align: 'left' | 'right' = 'left') {
  const r = b?.getBoundingClientRect();
  return { x: (align === 'left' ? r?.left : r?.right) ?? 0, y: (r?.bottom ?? 0) + 8 };
}

// ------------------------------------------------------------------ bars

export function DeckLeftBar() {
  const deck = useDeck();
  const [menu, setMenu] = useState<null | 'title' | 'shapes' | 'icons'>(null);
  const [renaming, setRenaming] = useState(false);
  const titleBtn = useRef<HTMLButtonElement>(null);
  const shapesBtn = useRef<HTMLButtonElement>(null);
  const iconsBtn = useRef<HTMLButtonElement>(null);
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="bar left" role="toolbar" aria-label="插入">
      {renaming ? (
        <input
          className="deck-title-input"
          autoFocus
          defaultValue={deck.title}
          aria-label="演示文稿名称"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
          onBlur={(e) => {
            setRenaming(false);
            renameDeck(e.currentTarget.value);
          }}
        />
      ) : (
        <button ref={titleBtn} className="tb text" aria-haspopup="menu" aria-label={`${deck.title}，演示文稿`} onClick={() => setMenu('title')}>
          {deck.title}
          <span className="caret">
            <Caret />
          </span>
        </button>
      )}
      <span className="sep" />
      <button className="tb" aria-label="文本框" title="文本框：放到当前幻灯片中央" onClick={INSERT.text}>
        <TextT />
      </button>
      <button className="tb" aria-label="图片" title="图片：上传到演示文稿文件夹" onClick={() => file.current?.click()}>
        <ImageI />
      </button>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) void insertImageFile(f);
        }}
      />
      <button className="tb" aria-label="表格" title="表格" onClick={INSERT.table}>
        <TableI />
      </button>
      <button ref={shapesBtn} className="tb" aria-haspopup="menu" aria-label="形状" title="形状" onClick={() => setMenu('shapes')}>
        <Shapes />
        <span className="caret">
          <Caret />
        </span>
      </button>
      <button ref={iconsBtn} className="tb" aria-haspopup="menu" aria-label="图标" title="图标" onClick={() => setMenu('icons')}>
        <Star />
        <span className="caret">
          <Caret />
        </span>
      </button>
      {menu === 'title' && (
        <Menu {...at(titleBtn.current)} onClose={() => setMenu(null)} label="演示文稿">
          <div className="head">{deck.title}</div>
          <MenuItem label="重命名" onSelect={() => (setMenu(null), setRenaming(true))} />
          <MenuItem label="新幻灯片" onSelect={() => (setMenu(null), addSlide())} />
          <hr />
          <MenuItem label="所有项目…" onSelect={() => (location.href = '/')} />
        </Menu>
      )}
      {menu === 'shapes' && (
        <Menu {...at(shapesBtn.current)} onClose={() => setMenu(null)} label="形状">
          {SHAPE_KINDS.map((k) => (
            <MenuItem key={k} label={SHAPE_LABEL[k] ?? k} onSelect={() => (setMenu(null), INSERT.shape(k))} />
          ))}
        </Menu>
      )}
      {menu === 'icons' && (
        <Menu {...at(iconsBtn.current)} onClose={() => setMenu(null)} label="图标">
          <div className="icon-grid">
            {ICON_NAMES.map((n) => (
              <button key={n} className="mi" title={n} onClick={() => (setMenu(null), INSERT.icon(n))}>
                {n}
              </button>
            ))}
          </div>
        </Menu>
      )}
    </div>
  );
}

export function DeckRightBar() {
  const view = useStore((s) => s.deckView);
  const panelOpen = useStore((s) => s.panelOpen);
  const railOpen = useStore((s) => s.railOpen);
  const notesOpen = useStore((s) => s.notesOpen);
  const slide = useStore((s) => s.slide);
  const zoom = useStore((s) => s.stageZoom);
  const fit = useStore((s) => s.stageFit);
  const connected = useStore((s) => s.connected);
  const saving = useStore(isSaving);
  const journalOpen = useStore((s) => s.journalOpen);
  const [menu, setMenu] = useState<null | 'zoom' | 'export'>(null);
  const zoomBtn = useRef<HTMLButtonElement>(null);
  const exportBtn = useRef<HTMLButtonElement>(null);
  const shown = zoom ?? fit;
  const file = slide ? slideFile(slide) : null;
  return (
    <div className="bar right" role="toolbar" aria-label="视图">
      <button ref={exportBtn} className="tb" aria-haspopup="menu" aria-label="导出" title="导出" disabled={!file} onClick={() => setMenu('export')}>
        <Download />
      </button>
      <button className="tb" aria-label="演示" title="从当前幻灯片开始演示（Esc 退出）" onClick={() => startPresenting(slide)}>
        <Present />
      </button>
      <span className="sep" />
      <button
        className="tb"
        aria-pressed={view === 'grid'}
        aria-label={view === 'grid' ? '单页视图' : '总览视图'}
        title={view === 'grid' ? '单页视图' : '总览：按章节排开所有幻灯片'}
        onClick={() => useStore.setState({ deckView: view === 'grid' ? 'edit' : 'grid' })}
      >
        {view === 'grid' ? <SlideI /> : <GridI />}
      </button>
      {view === 'edit' && (
        <>
          <button className="tb" aria-pressed={railOpen} aria-label="缩略图" title="显示 / 隐藏缩略图" onClick={() => useStore.setState({ railOpen: !railOpen })}>
            <RailI />
          </button>
          <button className="tb" aria-pressed={notesOpen} aria-label="演讲者备注" title="显示 / 隐藏演讲者备注" onClick={() => useStore.setState({ notesOpen: !notesOpen })}>
            <NotesI />
          </button>
        </>
      )}
      <button className="tb" aria-pressed={panelOpen} aria-label="属性面板" title="属性面板（⌘\）" onClick={() => useStore.setState({ panelOpen: !panelOpen })}>
        <Panel />
      </button>
      {view === 'edit' && (
        <>
          <span className="sep" />
          <button ref={zoomBtn} className="tb text" aria-haspopup="menu" aria-label={`${Math.round(shown * 100)}%，缩放`} onClick={() => setMenu('zoom')}>
            <span className="zoomval">{Math.round(shown * 100)}%</span>
            <span className="caret">
              <Caret />
            </span>
          </button>
        </>
      )}
      <span className="sep" />
      <button className="tb" aria-pressed={journalOpen} aria-label="同步状态和改动记录" onClick={() => useStore.setState({ journalOpen: !journalOpen })}>
        <span className="sync">
          <span className={`dot ${!connected ? 'off' : saving ? 'busy' : ''}`} />
          {!connected ? '未连接' : saving ? '保存中' : '已同步'}
        </span>
      </button>
      {menu === 'zoom' && (
        <Menu {...at(zoomBtn.current, 'right')} align="right" onClose={() => setMenu(null)} label="缩放">
          <MenuItem label="适应幻灯片" keys="⇧1" checked={zoom === null} onSelect={() => (useStore.setState({ stageZoom: null }), setMenu(null))} />
          <hr />
          {[0.25, 0.5, 0.75, 1].map((z) => (
            <MenuItem key={z} label={`${z * 100}%`} checked={zoom === z} onSelect={() => (useStore.setState({ stageZoom: z }), setMenu(null))} />
          ))}
        </Menu>
      )}
      {menu === 'export' && file && (
        <Menu {...at(exportBtn.current, 'right')} align="right" onClose={() => setMenu(null)} label="导出">
          <MenuItem label="当前幻灯片 PNG" onSelect={() => (setMenu(null), void exportBoard(file, 'png1'))} />
          <MenuItem label="当前幻灯片 PNG @2x" onSelect={() => (setMenu(null), void exportBoard(file, 'png2'))} />
          <hr />
          <MenuItem label="幻灯片源文件 (.html)" onSelect={() => (setMenu(null), void exportBoard(file, 'source'))} />
        </Menu>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ rail

function SlideMenu({ id, x, y, onClose }: { id: string; x: number; y: number; onClose: () => void }) {
  const skipped = useStore((s) => isSkipped(display(s, slideFile(id))));
  const deck = useDeck();
  const starts = Object.entries(deck.sections).find(([, s]) => s.start === id)?.[0];
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Menu x={x} y={y} onClose={onClose} label="幻灯片">
      <MenuItem label="在后面新建幻灯片" onSelect={run(() => addSlide(id))} />
      <MenuItem label="复制幻灯片" keys="⌘D" onSelect={run(() => duplicateSlide(id))} />
      <MenuItem label={skipped ? '取消跳过' : '演示时跳过'} onSelect={run(() => toggleSkip(id))} />
      <MenuItem label="设为封面（缩略图）" checked={deck.cover === id} onSelect={run(() => setCover(id))} />
      <hr />
      {starts ? (
        <MenuItem label="移除这个章节（幻灯片保留）" onSelect={run(() => removeSection(starts))} />
      ) : (
        <MenuItem label="从这里开始新章节" onSelect={run(() => startSection(id))} />
      )}
      <hr />
      <MenuItem label="删除幻灯片" danger onSelect={run(() => void deleteSlide(id))} />
    </Menu>
  );
}

const Thumb = memo(function Thumb({ id, n, width, current, onMenu }: { id: string; n: number; width: number; current: boolean; onMenu: (id: string, x: number, y: number) => void }) {
  const file = slideFile(id);
  const skipped = useStore((s) => isSkipped(display(s, file)));
  const title = useStore((s) => slideTitle(display(s, file) ?? ''));
  const [drop, setDrop] = useState<'before' | 'after' | null>(null);
  return (
    <div
      className={`thumb ${current ? 'current' : ''} ${skipped ? 'skipped' : ''} ${drop ? 'drop-' + drop : ''}`}
      data-slide={id}
      role="option"
      aria-selected={current}
      aria-label={`第 ${n} 张${title ? `：${title}` : ''}${skipped ? '（演示时跳过）' : ''}`}
      tabIndex={0}
      draggable
      onClick={() => goToSlide(id)}
      onDoubleClick={() => useStore.setState({ deckView: 'edit' })}
      onContextMenu={(e) => {
        e.preventDefault();
        goToSlide(id);
        onMenu(id, e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        const ids = slidesOf(useStore.getState());
        const i = ids.indexOf(id);
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') ids[i + 1] && (goToSlide(ids[i + 1]), focusThumb(ids[i + 1]));
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') ids[i - 1] && (goToSlide(ids[i - 1]), focusThumb(ids[i - 1]));
        else if (e.key === 'Delete' || e.key === 'Backspace') void deleteSlide(id);
        else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') duplicateSlide(id);
        else if (e.key === 'Enter') addSlide(id);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-dc-slide', id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('application/x-dc-slide')) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        const horizontal = e.currentTarget.closest('.grid-runs') !== null;
        setDrop((horizontal ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2) ? 'before' : 'after');
      }}
      onDragLeave={() => setDrop(null)}
      onDrop={(e) => {
        const moved = e.dataTransfer.getData('application/x-dc-slide');
        const where = drop;
        setDrop(null);
        if (!moved || moved === id) return;
        e.preventDefault();
        const ids = slidesOf(useStore.getState()).filter((x) => x !== moved);
        const before = where === 'before' ? id : ids[ids.indexOf(id) + 1] ?? null;
        moveSlide(moved, before);
      }}
    >
      <span className="num">{n}</span>
      <div className="pic">
        <SlideFrame file={file} scale={width / SLIDE_W} still label={`第 ${n} 张缩略图`} />
        {skipped && <span className="badge">跳过</span>}
      </div>
    </div>
  );
});

function focusThumb(id: string) {
  requestAnimationFrame(() => (document.querySelector(`.thumb[data-slide="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus());
}

function SectionHead({ k, description, editable }: { k: string; description: string; editable: boolean }) {
  const [val, setVal] = useState(description);
  useEffect(() => setVal(description), [description]);
  if (k === '-') return null;
  return (
    <div className="sec-head">
      <input
        value={val}
        placeholder="描述这个章节"
        aria-label="章节描述"
        readOnly={!editable}
        onChange={(e) => setVal(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={() => val !== description && describeSection(k, val)}
      />
    </div>
  );
}

function Rail() {
  const ids = useSlides();
  const deck = useDeck();
  const current = useStore((s) => s.slide);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const runs = sectionRuns(deck, ids);
  let n = 0;
  useEffect(() => {
    if (current) document.querySelector(`.rail .thumb[data-slide="${CSS.escape(current)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  return (
    <nav className="rail" aria-label="幻灯片">
      <div role="listbox" aria-label="幻灯片缩略图">
        {runs.map((r) => (
          <div key={r.key} className="run">
            <SectionHead k={r.key} description={r.description} editable />
            {r.slides.map((id) => (
              <Thumb key={id} id={id} n={++n} width={168} current={id === current} onMenu={(i, x, y) => setMenu({ id: i, x, y })} />
            ))}
          </div>
        ))}
      </div>
      <button className="add-slide" onClick={() => addSlide(ids.at(-1) ?? null)} aria-label="新幻灯片">
        <Plus /> 新幻灯片
      </button>
      {menu && <SlideMenu {...menu} onClose={() => setMenu(null)} />}
    </nav>
  );
}

// ------------------------------------------------------------------ stage

function Stage() {
  const slide = useStore((s) => s.slide);
  const zoom = useStore((s) => s.stageZoom);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 450 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const fit = Math.max(0.05, Math.min((size.w - 48) / SLIDE_W, (size.h - 48) / SLIDE_H));
  useEffect(() => {
    if (useStore.getState().stageFit !== fit) useStore.setState({ stageFit: fit });
  }, [fit]);
  const scale = zoom ?? fit;
  const file = slide ? slideFile(slide) : null;
  const exists = useStore((s) => (file ? display(s, file) !== undefined : false));
  return (
    <div
      className="slide-stage"
      ref={box}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && file) useStore.setState({ selection: { kind: 'board', file }, menu: null });
      }}
    >
      {file && exists ? (
        <div className="slide-holder" style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}>
          <SlideFrame key={file} file={file} scale={scale} interactive label={`幻灯片 ${slide}`} />
        </div>
      ) : (
        <div className="empty-deck">
          还没有幻灯片。
          <button className="btn primary" onClick={() => addSlide(null)}>
            新建幻灯片
          </button>
        </div>
      )}
    </div>
  );
}

function NotesPane() {
  const slide = useStore((s) => s.slide);
  const file = slide ? slideFile(slide) : null;
  const notes = useStore((s) => (file ? slideNotes(display(s, file) ?? '') : ''));
  const [val, setVal] = useState(notes);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!focused.current) setVal(notes);
  }, [notes, slide]);
  const commit = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (slide && v !== notes) setNotes(slide, v);
  };
  return (
    <div className="notes-pane">
      <label htmlFor="slide-notes">演讲者备注</label>
      <textarea
        id="slide-notes"
        value={val}
        placeholder="这张幻灯片的讲稿。不会显示在幻灯片上。"
        disabled={!slide}
        maxLength={4000}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setVal(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(v), 900);
        }}
        onBlur={(e) => {
          focused.current = false;
          commit(e.currentTarget.value);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export function EditView() {
  const railOpen = useStore((s) => s.railOpen);
  const notesOpen = useStore((s) => s.notesOpen);
  return (
    <div className="deck-edit">
      {railOpen && <Rail />}
      <div className="deck-center">
        <Stage />
        {notesOpen && <NotesPane />}
        <div className="prompt-room" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ grid

export function GridView() {
  const ids = useSlides();
  const deck = useDeck();
  const current = useStore((s) => s.slide);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const runs = sectionRuns(deck, ids);
  let n = 0;
  return (
    <div className="deck-grid grid-runs" aria-label="所有幻灯片">
      {runs.map((r, i) => (
        <section key={r.key} className="grid-run" aria-label={r.key === '-' ? '开场' : r.description || `第 ${i + 1} 章`}>
          <header>
            <span className="sec-n">{r.key === '-' ? '开场' : `章节 ${i + 1}`}</span>
            {r.key !== '-' && <SectionHead k={r.key} description={r.description} editable />}
            {r.key !== '-' && (
              <button className="btn" onClick={() => removeSection(r.key)} title="移除这个章节（幻灯片保留）">
                移除章节
              </button>
            )}
          </header>
          <div className="grid-thumbs" role="listbox" aria-label="幻灯片">
            {r.slides.map((id) => (
              <Thumb key={id} id={id} n={++n} width={288} current={id === current} onMenu={(x, cx, cy) => setMenu({ id: x, x: cx, y: cy })} />
            ))}
            {!r.slides.length && <div className="empty">空章节</div>}
          </div>
        </section>
      ))}
      <button className="add-slide" onClick={() => addSlide(ids.at(-1) ?? null)}>
        <Plus /> 新幻灯片
      </button>
      {menu && <SlideMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
