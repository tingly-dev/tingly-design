import type React from 'react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BOARD_SIZES, type Size } from '@dc/core';
import { addBoardOfSize, addPage, renamePage } from '../../actions';
import { editCanvas, useCanvas, useStore, type Tool } from '../../store';
import { readSizes } from '../motion/motionSizes';
import { fitAll, zoomAt, zoomToSelection, setView } from './view';
import { Menu, MenuItem } from '../Menu';
import {
  ArrowI,
  Caret,
  Cursor,
  Frame,
  Hand,
  LineI,
  Note,
  Oval,
  Pen,
  Play,
  Rect,
  Shapes,
  TextT,
} from '../icons';
import { InlineRename } from '../InlineRename';
import { FileMenu } from '../FileMenu';
import { canvasExportItems } from './Board';
import { useDirectPdf } from '../../pdfExport';
import { canvasImport } from './canvasImport';
import { TopBar, ProjectTitle, BarButton } from '../TopBar';

/** The sizes the artboard menu offers by name: the common screen, phone, 16:9 and square (every other is in the panel's list). */
const QUICK_BOARDS = ['desktop', 'iphone15', 'wide', 'square'] as const;

const SHAPES: { tool: 'rect' | 'oval' | 'arrow' | 'line'; keys: string; icon: React.ReactElement }[] = [
  { tool: 'rect', keys: 'R', icon: <Rect /> },
  { tool: 'oval', keys: 'O', icon: <Oval /> },
  { tool: 'arrow', keys: '⇧L', icon: <ArrowI /> },
  { tool: 'line', keys: 'L', icon: <LineI /> },
];

function ToolButton({ tool, label, keys, children }: { tool: Tool; label: string; keys: string; children: React.ReactElement }) {
  const { t } = useTranslation();
  const current = useStore((s) => s.tool);
  return (
    <button
      className="tb"
      aria-pressed={current === tool}
      aria-label={label}
      title={t('app.tool.withKeys', { label, keys })}
      onClick={() => useStore.setState({ tool: current === tool && tool !== 'select' ? 'select' : tool, mode: 'edit' })}
    >
      {children}
    </button>
  );
}

function BoardSizeItem({ size, label, onDone }: { size: Size; label?: string; onDone: () => void }) {
  return (
    <MenuItem
      label={label ? `${label} ${size[0]} × ${size[1]}` : `${size[0]} × ${size[1]}`}
      onSelect={() => {
        addBoardOfSize(size);
        onDone();
      }}
    />
  );
}

function PagesMenu({ onClose, x, y }: { onClose: () => void; x: number; y: number }) {
  const { t } = useTranslation();
  const canvas = useCanvas();
  const page = useStore((s) => s.page);
  const current = page || canvas.pages[0]?.id || '';
  const [renaming, setRenaming] = useState<string | null>(null);
  const pages = canvas.pages.length ? canvas.pages : [{ id: '', name: t('app.page.name', { n: 1 }) }];
  return (
    <Menu x={x} y={y} onClose={onClose} label={t('app.pages.label')}>
      <div className="head">{canvas.title}</div>
      {pages.map((p) =>
        renaming === p.id ? (
          <div key={p.id} style={{ padding: '2px 4px' }}>
            <InlineRename value={p.name} label={t('app.pages.nameLabel')} onCommit={(v) => renamePage(p.id, v)} onDone={() => setRenaming(null)} />
          </div>
        ) : (
          <MenuItem
            key={p.id}
            label={p.name}
            checked={p.id === current}
            onSelect={() => {
              if (p.id === current && p.id) setRenaming(p.id);
              else {
                useStore.setState({ page: p.id, selection: null });
                onClose();
                setTimeout(fitAll, 30);
              }
            }}
          />
        ),
      )}
      <hr />
      <MenuItem
        label={t('app.pages.add')}
        onSelect={() => {
          addPage();
          onClose();
        }}
      />
    </Menu>
  );
}

/** The canvas's top bar: its name, the save state, and Import / Export; the tools float over the canvas. */
export function CanvasTopBar() {
  const { t } = useTranslation();
  const canvas = useCanvas();
  const mode = useStore((s) => s.mode);
  const direct = useDirectPdf();
  return (
    <TopBar
      title={<ProjectTitle value={canvas.title} label={t('panel.canvas.nameLabel')} hint={t('common.topbar.rename')} onRename={(v) => editCanvas((c) => (c.title = v), `title → ${v}`)} />}
    >
      <BarButton
        icon={<Play />}
        label={mode === 'play' ? t('app.view.exitPlay') : t('app.view.play')}
        title={t('app.view.playHint')}
        on={mode === 'play'}
        onClick={() => {
          if (mode === 'play' && document.fullscreenElement) document.exitFullscreen().catch(() => {});
          useStore.setState({ mode: mode === 'play' ? 'edit' : 'play', tool: 'select', menu: null });
        }}
      />
      <FileMenu claudeDesign target={canvasImport} label={t('app.importTarget')} items={() => canvasExportItems(direct)} />
    </TopBar>
  );
}

export function LeftBar() {
  const { t } = useTranslation();
  const canvas = useCanvas();
  const page = useStore((s) => s.page);
  const tool = useStore((s) => s.tool);
  const [menu, setMenu] = useState<null | 'pages' | 'shapes' | 'frame'>(null);
  const pagesBtn = useRef<HTMLButtonElement>(null);
  const shapesBtn = useRef<HTMLButtonElement>(null);
  const frameBtn = useRef<HTMLButtonElement>(null);
  const selected = useStore((s) => (s.selection?.kind === 'board' || s.selection?.kind === 'el' ? canvas.boards[s.selection.file] : undefined));
  const pageName = canvas.pages.find((p) => p.id === (page || canvas.pages[0]?.id))?.name ?? t('app.page.name', { n: 1 });
  const shape = SHAPES.find((s) => s.tool === tool);
  const at = (b: HTMLButtonElement | null) => {
    const r = b?.getBoundingClientRect();
    return { x: r?.left ?? 0, y: (r?.bottom ?? 0) + 8 };
  };
  // the sizes the menu offers, each once: the selected board's, the common ones, then the person's own
  const sizes: { size: Size; label?: string }[] = [];
  const offer = (size: Size, label?: string) => sizes.some((o) => o.size[0] === size[0] && o.size[1] === size[1]) || sizes.push({ size, label });
  if (selected) offer([selected.w, selected.h], t('app.tool.frameSame', { title: selected.title || t('app.tool.frame') }));
  for (const id of QUICK_BOARDS) offer(BOARD_SIZES.find((b) => b.id === id)!.size, t(`canvas.boardSize.${id}`));
  if (menu === 'frame') for (const m of readSizes().mine) offer(m);
  return (
    <div className="bar left" role="toolbar" aria-label={t('app.tool.bar')}>
      <button ref={pagesBtn} className="tb text" aria-haspopup="menu" aria-label={t('app.pages.button', { name: pageName })} onClick={() => setMenu('pages')}>
        {pageName}
        <span className="caret">
          <Caret />
        </span>
      </button>
      <span className="sep" />
      <ToolButton tool="select" label={t('app.tool.select')} keys="V">
        <Cursor />
      </ToolButton>
      <ToolButton tool="hand" label={t('app.tool.hand')} keys="H">
        <Hand />
      </ToolButton>
      <ToolButton tool="text" label={t('app.tool.text')} keys="T">
        <TextT />
      </ToolButton>
      <button
        ref={frameBtn}
        className="tb"
        aria-pressed={tool === 'frame'}
        aria-haspopup="menu"
        aria-label={t('app.tool.frame')}
        title={t('app.tool.withKeys', { label: t('app.tool.frame'), keys: 'A' })}
        onClick={() => (tool === 'frame' ? useStore.setState({ tool: 'select' }) : setMenu('frame'))}
      >
        <Frame />
        <span className="caret">
          <Caret />
        </span>
      </button>
      <ToolButton tool="note" label={t('app.tool.note')} keys="N">
        <Note />
      </ToolButton>
      <ToolButton tool="draw" label={t('app.tool.draw')} keys="P">
        <Pen />
      </ToolButton>
      <button
        ref={shapesBtn}
        className="tb"
        aria-pressed={!!shape}
        aria-haspopup="menu"
        aria-label={t('app.tool.shapes')}
        title={t('app.tool.shapes')}
        onClick={() => setMenu('shapes')}
      >
        {shape?.icon ?? <Shapes />}
        <span className="caret">
          <Caret />
        </span>
      </button>
      {menu === 'pages' && <PagesMenu {...at(pagesBtn.current)} onClose={() => setMenu(null)} />}
      {menu === 'frame' && (
        <Menu {...at(frameBtn.current)} onClose={() => setMenu(null)} label={t('app.tool.frame')}>
          <MenuItem
            label={t('app.tool.frameDraw')}
            keys="A"
            icon={<Frame />}
            onSelect={() => {
              useStore.setState({ tool: 'frame', mode: 'edit' });
              setMenu(null);
            }}
          />
          <hr />
          <div className="head">{t('app.tool.frameAdd')}</div>
          {sizes.map((o) => (
            <BoardSizeItem key={o.size.join('x')} size={o.size} label={o.label} onDone={() => setMenu(null)} />
          ))}
        </Menu>
      )}
      {menu === 'shapes' && (
        <Menu {...at(shapesBtn.current)} onClose={() => setMenu(null)} label={t('app.tool.shapes')}>
          {SHAPES.map((s) => (
            <MenuItem
              key={s.tool}
              label={t(`app.shape.${s.tool}`)}
              keys={s.keys}
              icon={s.icon}
              onSelect={() => {
                useStore.setState({ tool: s.tool, mode: 'edit' });
                setMenu(null);
              }}
            />
          ))}
        </Menu>
      )}
    </div>
  );
}

export function RightBar() {
  const { t } = useTranslation();
  const zoom = useStore((s) => s.view.zoom);
  const viewport = useStore((s) => s.viewport);
  const [zoomMenu, setZoomMenu] = useState(false);
  const zoomBtn = useRef<HTMLButtonElement>(null);
  const r = zoomBtn.current?.getBoundingClientRect();
  const setZoom = (z: number) => {
    const s = useStore.getState();
    const k = z / s.view.zoom;
    const cx = s.viewport.w / 2;
    const cy = s.viewport.h / 2;
    setView({ zoom: z, x: cx - (cx - s.view.x) * k, y: cy - (cy - s.view.y) * k });
  };
  return (
    <div className="bar right" role="toolbar" aria-label={t('app.view.bar')}>
      <button ref={zoomBtn} className="tb text" aria-haspopup="menu" aria-label={t('app.view.zoomButton', { zoom: Math.round(zoom * 100) })} onClick={() => setZoomMenu(true)}>
        <span className="zoomval">{Math.round(zoom * 100)}%</span>
        <span className="caret">
          <Caret />
        </span>
      </button>
      {zoomMenu && (
        <Menu x={(r?.right ?? 0)} y={(r?.bottom ?? 0) + 8} align="right" onClose={() => setZoomMenu(false)} label={t('app.view.zoom')}>
          <MenuItem label={t('app.view.zoomIn')} keys="⌘+" onSelect={() => zoomAt(1.25, viewport.w / 2, viewport.h / 2)} />
          <MenuItem label={t('app.view.zoomOut')} keys="⌘−" onSelect={() => zoomAt(0.8, viewport.w / 2, viewport.h / 2)} />
          <hr />
          <MenuItem label={t('app.view.fitAll')} keys="⇧1" onSelect={() => (fitAll(), setZoomMenu(false))} />
          <MenuItem label={t('app.view.zoomToSelection')} keys="⇧2" onSelect={() => (zoomToSelection(), setZoomMenu(false))} />
          <hr />
          {[0.5, 1, 2].map((z) => (
            <MenuItem key={z} label={`${z * 100}%`} keys={z === 1 ? '⌘0' : undefined} onSelect={() => (setZoom(z), setZoomMenu(false))} />
          ))}
        </Menu>
      )}
    </div>
  );
}
