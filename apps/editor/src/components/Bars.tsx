import type React from 'react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addPage, renamePage } from '../actions';
import { fitAll, isSaving, useCanvas, useStore, zoomAt, zoomToSelection, setView, type Tool } from '../store';
import { Menu, MenuItem } from './Menu';
import {
  ArrowI,
  Caret,
  Cursor,
  Frame,
  Hand,
  LineI,
  Note,
  Oval,
  Panel,
  Pen,
  Play,
  Rect,
  Shapes,
  TextT,
} from './icons';
import { goTo } from '../host';
import { ImportHere } from './ImportHere';
import { canvasImport } from '../canvasImport';

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
            <input
              autoFocus
              defaultValue={p.name}
              aria-label={t('app.pages.nameLabel')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  renamePage(p.id, e.currentTarget.value);
                  setRenaming(null);
                }
                if (e.key === 'Escape') setRenaming(null);
              }}
              onBlur={(e) => {
                renamePage(p.id, e.currentTarget.value);
                setRenaming(null);
              }}
            />
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
      <MenuItem label={t('app.pages.allCanvases')} onSelect={() => goTo(null)} />
    </Menu>
  );
}

export function LeftBar() {
  const { t } = useTranslation();
  const canvas = useCanvas();
  const page = useStore((s) => s.page);
  const tool = useStore((s) => s.tool);
  const [menu, setMenu] = useState<null | 'pages' | 'shapes'>(null);
  const pagesBtn = useRef<HTMLButtonElement>(null);
  const shapesBtn = useRef<HTMLButtonElement>(null);
  const pageName = canvas.pages.find((p) => p.id === (page || canvas.pages[0]?.id))?.name ?? t('app.page.name', { n: 1 });
  const shape = SHAPES.find((s) => s.tool === tool);
  const at = (b: HTMLButtonElement | null) => {
    const r = b?.getBoundingClientRect();
    return { x: r?.left ?? 0, y: (r?.bottom ?? 0) + 8 };
  };
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
      <ToolButton tool="frame" label={t('app.tool.frame')} keys="A">
        <Frame />
      </ToolButton>
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
      <span className="sep" />
      <ImportHere target={canvasImport} label={t('app.importTarget')} />
      {menu === 'pages' && <PagesMenu {...at(pagesBtn.current)} onClose={() => setMenu(null)} />}
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
  const mode = useStore((s) => s.mode);
  const panelOpen = useStore((s) => s.panelOpen);
  const zoom = useStore((s) => s.view.zoom);
  const viewport = useStore((s) => s.viewport);
  const connected = useStore((s) => s.connected);
  const saving = useStore(isSaving);
  const journalOpen = useStore((s) => s.journalOpen);
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
      <button
        className="tb"
        aria-pressed={mode === 'play'}
        aria-label={mode === 'play' ? t('app.view.exitPlay') : t('app.view.play')}
        title={t('app.view.playHint')}
        onClick={() => useStore.setState({ mode: mode === 'play' ? 'edit' : 'play', tool: 'select', menu: null })}
      >
        <Play />
      </button>
      <button
        className="tb"
        aria-pressed={panelOpen}
        aria-label={t('app.view.panel')}
        title={t('app.view.panelHint')}
        onClick={() => useStore.setState({ panelOpen: !panelOpen })}
      >
        <Panel />
      </button>
      <span className="sep" />
      <button ref={zoomBtn} className="tb text" aria-haspopup="menu" aria-label={t('app.view.zoomButton', { zoom: Math.round(zoom * 100) })} onClick={() => setZoomMenu(true)}>
        <span className="zoomval">{Math.round(zoom * 100)}%</span>
        <span className="caret">
          <Caret />
        </span>
      </button>
      <span className="sep" />
      <button
        className="tb"
        aria-pressed={journalOpen}
        aria-label={t('app.view.sync')}
        onClick={() => useStore.setState({ journalOpen: !journalOpen })}
      >
        <span className="sync">
          <span className={`dot ${!connected ? 'off' : saving ? 'busy' : ''}`} />
          {!connected ? t('app.view.offline') : saving ? t('app.view.saving') : t('app.view.synced')}
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
