import type React from 'react';
import { useRef, useState } from 'react';
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

const SHAPES: { tool: Tool; label: string; keys: string; icon: React.ReactElement }[] = [
  { tool: 'rect', label: '矩形', keys: 'R', icon: <Rect /> },
  { tool: 'oval', label: '椭圆', keys: 'O', icon: <Oval /> },
  { tool: 'arrow', label: '箭头', keys: '⇧L', icon: <ArrowI /> },
  { tool: 'line', label: '直线', keys: 'L', icon: <LineI /> },
];

function ToolButton({ tool, label, keys, children }: { tool: Tool; label: string; keys: string; children: React.ReactElement }) {
  const current = useStore((s) => s.tool);
  return (
    <button
      className="tb"
      aria-pressed={current === tool}
      aria-label={label}
      title={`${label}（${keys}）`}
      onClick={() => useStore.setState({ tool: current === tool && tool !== 'select' ? 'select' : tool, mode: 'edit' })}
    >
      {children}
    </button>
  );
}

function PagesMenu({ onClose, x, y }: { onClose: () => void; x: number; y: number }) {
  const canvas = useCanvas();
  const page = useStore((s) => s.page);
  const current = page || canvas.pages[0]?.id || '';
  const [renaming, setRenaming] = useState<string | null>(null);
  const pages = canvas.pages.length ? canvas.pages : [{ id: '', name: '第 1 页' }];
  return (
    <Menu x={x} y={y} onClose={onClose} label="页面">
      <div className="head">{canvas.title}</div>
      {pages.map((p) =>
        renaming === p.id ? (
          <div key={p.id} style={{ padding: '2px 4px' }}>
            <input
              autoFocus
              defaultValue={p.name}
              aria-label="页面名称"
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
        label="新建页面"
        onSelect={() => {
          addPage();
          onClose();
        }}
      />
      <MenuItem label="所有画布…" onSelect={() => goTo(null)} />
    </Menu>
  );
}

export function LeftBar() {
  const canvas = useCanvas();
  const page = useStore((s) => s.page);
  const tool = useStore((s) => s.tool);
  const [menu, setMenu] = useState<null | 'pages' | 'shapes'>(null);
  const pagesBtn = useRef<HTMLButtonElement>(null);
  const shapesBtn = useRef<HTMLButtonElement>(null);
  const pageName = canvas.pages.find((p) => p.id === (page || canvas.pages[0]?.id))?.name ?? '第 1 页';
  const shape = SHAPES.find((s) => s.tool === tool);
  const at = (b: HTMLButtonElement | null) => {
    const r = b?.getBoundingClientRect();
    return { x: r?.left ?? 0, y: (r?.bottom ?? 0) + 8 };
  };
  return (
    <div className="bar left" role="toolbar" aria-label="工具">
      <button ref={pagesBtn} className="tb text" aria-haspopup="menu" aria-label={`${pageName}，页面`} onClick={() => setMenu('pages')}>
        {pageName}
        <span className="caret">
          <Caret />
        </span>
      </button>
      <span className="sep" />
      <ToolButton tool="select" label="选择" keys="V">
        <Cursor />
      </ToolButton>
      <ToolButton tool="hand" label="抓手" keys="H">
        <Hand />
      </ToolButton>
      <ToolButton tool="text" label="文字" keys="T">
        <TextT />
      </ToolButton>
      <ToolButton tool="frame" label="画板" keys="A">
        <Frame />
      </ToolButton>
      <ToolButton tool="note" label="便签" keys="N">
        <Note />
      </ToolButton>
      <ToolButton tool="draw" label="画笔" keys="P">
        <Pen />
      </ToolButton>
      <button
        ref={shapesBtn}
        className="tb"
        aria-pressed={!!shape}
        aria-haspopup="menu"
        aria-label="形状和线条"
        title="形状和线条"
        onClick={() => setMenu('shapes')}
      >
        {shape?.icon ?? <Shapes />}
        <span className="caret">
          <Caret />
        </span>
      </button>
      {menu === 'pages' && <PagesMenu {...at(pagesBtn.current)} onClose={() => setMenu(null)} />}
      {menu === 'shapes' && (
        <Menu {...at(shapesBtn.current)} onClose={() => setMenu(null)} label="形状和线条">
          {SHAPES.map((s) => (
            <MenuItem
              key={s.tool}
              label={s.label}
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
    <div className="bar right" role="toolbar" aria-label="视图">
      <button
        className="tb"
        aria-pressed={mode === 'play'}
        aria-label={mode === 'play' ? '退出播放' : '播放'}
        title="播放：按钮和链接可以点（Esc 退出）"
        onClick={() => useStore.setState({ mode: mode === 'play' ? 'edit' : 'play', tool: 'select', menu: null })}
      >
        <Play />
      </button>
      <button
        className="tb"
        aria-pressed={panelOpen}
        aria-label="属性面板"
        title="属性面板（⌘\）"
        onClick={() => useStore.setState({ panelOpen: !panelOpen })}
      >
        <Panel />
      </button>
      <span className="sep" />
      <button ref={zoomBtn} className="tb text" aria-haspopup="menu" aria-label={`${Math.round(zoom * 100)}%，缩放`} onClick={() => setZoomMenu(true)}>
        <span className="zoomval">{Math.round(zoom * 100)}%</span>
        <span className="caret">
          <Caret />
        </span>
      </button>
      <span className="sep" />
      <button
        className="tb"
        aria-pressed={journalOpen}
        aria-label="同步状态和改动记录"
        onClick={() => useStore.setState({ journalOpen: !journalOpen })}
      >
        <span className="sync">
          <span className={`dot ${!connected ? 'off' : saving ? 'busy' : ''}`} />
          {!connected ? '未连接' : saving ? '保存中' : '已同步'}
        </span>
      </button>
      {zoomMenu && (
        <Menu x={(r?.right ?? 0)} y={(r?.bottom ?? 0) + 8} align="right" onClose={() => setZoomMenu(false)} label="缩放">
          <MenuItem label="放大" keys="⌘+" onSelect={() => zoomAt(1.25, viewport.w / 2, viewport.h / 2)} />
          <MenuItem label="缩小" keys="⌘−" onSelect={() => zoomAt(0.8, viewport.w / 2, viewport.h / 2)} />
          <hr />
          <MenuItem label="适应全部" keys="⇧1" onSelect={() => (fitAll(), setZoomMenu(false))} />
          <MenuItem label="缩放到选中" keys="⇧2" onSelect={() => (zoomToSelection(), setZoomMenu(false))} />
          <hr />
          {[0.5, 1, 2].map((z) => (
            <MenuItem key={z} label={`${z * 100}%`} keys={z === 1 ? '⌘0' : undefined} onSelect={() => (setZoom(z), setZoomMenu(false))} />
          ))}
        </Menu>
      )}
    </div>
  );
}
