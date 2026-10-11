import type React from 'react';
import { display, parsed, useCanvas, useStore } from '../../store';
import { Close } from '../icons';
import { CodeTab } from './CodeTab';
import { ElementProps } from './ElementProps';
import { LayerTree } from './LayerTree';
import { BoardProps, ItemProps, Tweaks } from './OtherProps';
import { Field, Row } from './fields';
import { editCanvas } from '../../store';

/** Layers on top; Properties / Code / Tweaks for whatever is selected below. */
export function RightPanel() {
  const tab = useStore((s) => s.panelTab);
  const sel = useStore((s) => s.selection);
  const canvas = useCanvas();
  const file = sel?.kind === 'el' || sel?.kind === 'board' ? sel.file : null;
  const source = useStore((s) => (file ? display(s, file) : undefined));
  const inspect = useStore((s) => s.inspect);
  const doc = source ? parsed(source) : null;
  const el = sel?.kind === 'el' && doc ? doc.elements[sel.tid] : undefined;
  const info = el && inspect?.tid === el.tid ? inspect : null;

  let body: React.ReactElement;
  if (sel?.kind === 'el' && file && doc) {
    if (!el) body = <div className="empty">这个元素已经不在设计里了。</div>;
    else if (tab === 'code') body = <CodeTab file={file} doc={doc} el={el} info={info} />;
    else if (tab === 'tweaks') body = <Tweaks file={file} doc={doc} />;
    else body = <ElementProps key={`${file}#${el.tid}`} file={file} el={el} info={info} />;
  } else if (sel?.kind === 'board' && file && canvas.boards[file]) {
    if (tab === 'tweaks' && doc) body = <Tweaks file={file} doc={doc} />;
    else if (tab === 'code')
      body = (
        <div className="sec">
          <span className="hint">{file}</span>
          <textarea className="code" readOnly value={source ?? ''} style={{ minHeight: 360 }} aria-label="画板源文件" />
          <span className="hint">这是画板的源文件。改文件（手改、Claude Code、git）后画布会实时更新。</span>
        </div>
      );
    else body = <BoardProps file={file} entry={canvas.boards[file]} />;
  } else if (sel?.kind === 'note' && canvas.notes[sel.id]) {
    body = <ItemProps id={sel.id} note={canvas.notes[sel.id]} />;
  } else {
    body = (
      <div className="sec">
        <div className="empty" style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <div style={{ color: 'var(--ink)', fontWeight: 500 }}>未选中任何内容</div>
          点击设计里的任意元素，在这里编辑。
        </div>
        <h3>画布</h3>
        <Row label="名称">
          <Field value={canvas.title} numeric={false} onCommit={(v) => v.trim() && editCanvas((c) => (c.title = v.trim()), `title → ${v.trim()}`)} label="画布名称" />
        </Row>
        <p className="hint" style={{ margin: 0 }}>
          点选画板里的任意元素来编辑；双击文字直接改。拖动已选中的元素可以调整顺序，拖出父容器就变成自由定位。
        </p>
        <p className="hint" style={{ margin: 0 }}>
          V 选择 · H 抓手 · T 文字 · A 画板 · N 便签 · P 画笔 · R 矩形 · O 椭圆 · L 直线 · ⇧1 适应全部 · ⇧2 缩放到选中 · Esc 取消选中 · ⇧↵ 选中上一级 · ↵ 选中下一级
        </p>
      </div>
    );
  }

  const tabs: { id: typeof tab; label: string }[] = [
    { id: 'props', label: '属性' },
    { id: 'code', label: '代码' },
    { id: 'tweaks', label: 'Tweaks' },
  ];
  return (
    <aside className="panel" aria-label="属性面板">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => useStore.setState({ panelTab: t.id })}>
            {t.label}
          </button>
        ))}
        <button className="ib x" aria-label="关闭属性面板" title="关闭（⌘\）" onClick={() => useStore.setState({ panelOpen: false })}>
          <Close />
        </button>
      </div>
      <LayerTree />
      <div className="pbody">{body}</div>
    </aside>
  );
}
