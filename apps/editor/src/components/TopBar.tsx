import { CANVAS_FILE, newBoardSource, nextBoardPosition, uniqueBoardName } from '@dc/core';
import { api } from '../api';
import {
  canvasOf,
  edit,
  editCanvas,
  fitAll,
  focusBoard,
  isSaving,
  redo,
  toast,
  undo,
  useCanvas,
  useStore,
  zoomAt,
} from '../store';
import { Board, Commit, Cursor, Fit, Hand, Minus, Note, Play, Plus, Redo, Undo } from './icons';

function addBoard() {
  const c = canvasOf(useStore.getState());
  const title = prompt('新画板的名称', '新画板');
  if (title === null) return;
  const stem = title.replace(/[^A-Za-z0-9_-]/g, '') || 'Board';
  const file = uniqueBoardName(c, stem);
  const w = 1200;
  const h = 760;
  const pos = nextBoardPosition(c, w);
  edit(file, () => newBoardSource({ title: title || file, w, h }), { actor: 'human', summary: 'artboard created', undoable: false });
  editCanvas((cc) => {
    cc.boards[file] = { ...pos, w, h, title: title || undefined };
    cc.order.push(file);
  }, `artboard ${file} added`);
  useStore.setState({ selection: { kind: 'board', file } });
  setTimeout(() => focusBoard(file), 50);
}

function addNote() {
  const s = useStore.getState();
  const { view, viewport } = s;
  const x = Math.round((viewport.w / 2 - view.x) / view.zoom - 160);
  const y = Math.round((viewport.h / 2 - view.y) / view.zoom - 120);
  const id = 'n' + Date.now().toString(36);
  editCanvas((c) => {
    c.notes[id] = { x, y, w: 320, text: '新便签', fill: 'orange', size: 20 };
  }, `note ${id} added`);
  useStore.setState({ selection: { kind: 'note', id } });
}

async function commit() {
  const p = useStore.getState().project;
  if (!p) return;
  const msg = prompt('提交说明', `canvas(${p}): ${canvasOf(useStore.getState()).title}`);
  if (msg === null) return;
  const r = await api.commit(p, msg);
  toast(r.output, r.ok ? 'info' : 'error');
}

export function TopBar() {
  const canvas = useCanvas();
  const tool = useStore((s) => s.tool);
  const mode = useStore((s) => s.mode);
  const zoom = useStore((s) => s.view.zoom);
  const viewport = useStore((s) => s.viewport);
  const connected = useStore((s) => s.connected);
  const saving = useStore(isSaving);
  const canUndo = useStore((s) => s.undo.length > 0);
  const canRedo = useStore((s) => s.redo.length > 0);
  const health = useStore((s) => s.health);
  const project = useStore((s) => s.project);

  return (
    <header className="top">
      <a className="btn" href="/" title="所有画布" aria-label="所有画布">
        <Board />
      </a>
      <span className="title" title={`projects/${project}/${CANVAS_FILE}`}>
        {canvas.title}
      </span>
      <span className="sep" />
      <button className={`btn ${mode === 'edit' && tool === 'select' ? 'on' : ''}`} onClick={() => useStore.setState({ tool: 'select', mode: 'edit' })} title="选择（V）" aria-label="选择">
        <Cursor />
      </button>
      <button className={`btn ${mode === 'edit' && tool === 'hand' ? 'on' : ''}`} onClick={() => useStore.setState({ tool: 'hand', mode: 'edit' })} title="抓手（H，或按住空格）" aria-label="抓手">
        <Hand />
      </button>
      <button
        className={`btn ${mode === 'play' ? 'on' : ''}`}
        onClick={() => useStore.setState({ mode: mode === 'play' ? 'edit' : 'play', selection: null })}
        title="播放：按钮和链接可点（P，Esc 退出）"
      >
        <Play /> {mode === 'play' ? '退出播放' : '播放'}
      </button>
      <span className="sep" />
      <button className="btn" onClick={addBoard} disabled={mode === 'play'} title="新建画板">
        <Board /> 画板
      </button>
      <button className="btn" onClick={addNote} disabled={mode === 'play'} title="新建便签">
        <Note /> 便签
      </button>
      <span className="sep" />
      <button className="btn" onClick={undo} disabled={!canUndo} title="撤销（⌘Z）" aria-label="撤销">
        <Undo />
      </button>
      <button className="btn" onClick={redo} disabled={!canRedo} title="重做（⇧⌘Z）" aria-label="重做">
        <Redo />
      </button>
      <span className="grow" />
      <button className="btn" onClick={() => zoomAt(0.8, viewport.w / 2, viewport.h / 2)} aria-label="缩小">
        <Minus />
      </button>
      <button className="btn zoom" onClick={fitAll} title="适应窗口（0）">
        {Math.round(zoom * 100)}%
      </button>
      <button className="btn" onClick={() => zoomAt(1.25, viewport.w / 2, viewport.h / 2)} aria-label="放大">
        <Plus />
      </button>
      <button className="btn" onClick={fitAll} title="适应窗口（0）" aria-label="适应窗口">
        <Fit />
      </button>
      <span className="sep" />
      <span
        className="status"
        title={`快速 AI：${health?.fastEdit ? health.fastModel : '未配置 API key'}；Claude Code：${health?.claudeCli ? '可用' : '不可用'}`}
      >
        <span className={`dot ${!connected ? 'off' : saving ? 'busy' : ''}`} />
        {!connected ? '未连接' : saving ? '保存中' : '已同步'}
      </span>
      <button className="btn outline" onClick={commit} title="把这个画布的改动提交到 git">
        <Commit /> 提交
      </button>
    </header>
  );
}
