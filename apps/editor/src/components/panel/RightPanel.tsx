import type React from 'react';
import { attr } from '@dc/core';
import { display, parsed, useCanvas, useStore } from '../../store';
import { Close } from '../icons';
import { CodeTab } from './CodeTab';
import { ElementProps } from './ElementProps';
import { LayerTree } from './LayerTree';
import { BoardProps, ItemProps, Tweaks } from './OtherProps';
import { Field, Row } from './fields';
import { editCanvas } from '../../store';
import { BuildRow, DeckProps, SlideLayers, SlideProps } from '../slides/SlidePanel';
import { DsInstall } from './DsInstall';
import { JQueryBox } from './JQueryBox';
import { FormatNote, MotionLayers, MotionProps, SceneProps } from '../motion/MotionPanel';

/** Layers on top; Properties / Code / Tweaks for whatever is selected below. */
export function RightPanel() {
  const tab = useStore((s) => s.panelTab);
  const sel = useStore((s) => s.selection);
  const canvas = useCanvas();
  const slides = useStore((s) => s.kind === 'slides');
  const motion = useStore((s) => s.kind === 'motion');
  // with nothing selected, the Code tab of a deck or a motion piece shows the slide or scene on stage
  const onStage = useStore((s) =>
    s.kind === 'slides' && s.slide ? `slides/${s.slide}.html` : s.kind === 'motion' && s.motionView?.scene ? `scenes/${s.motionView.scene}.html` : null,
  );
  const file = sel?.kind === 'el' || sel?.kind === 'board' ? sel.file : !sel && tab === 'code' ? onStage : null;
  const source = useStore((s) => (file ? display(s, file) : undefined));
  const inspect = useStore((s) => s.inspect);
  const doc = source ? parsed(source) : null;
  const el = sel?.kind === 'el' && doc ? doc.elements[sel.tid] : undefined;
  const info = el && inspect?.tid === el.tid ? inspect : null;
  // how jQuery addresses the selected element: its own id, else the handle the editor numbers
  const handle = el ? (attr(el, 'id') ? `#${attr(el, 'id')}` : `#dc${el.tid}`) : undefined;

  let body: React.ReactElement;
  if (motion) {
    if (file && tab === 'code') {
      body = (
        <>
          <div className="sec">
            <span className="hint">{file}</span>
            <textarea className="code" readOnly value={source ?? ''} style={{ minHeight: 360 }} aria-label="场景源文件" />
            <span className="hint">这是这个场景的源文件。改文件（手改、Claude Code、git）后会实时更新。</span>
          </div>
          <JQueryBox file={file} handle={handle} />
        </>
      );
    } else if (sel?.kind === 'board' && file) body = <SceneProps file={file} />;
    else if (sel?.kind === 'el' && file && doc && el && !el.parent) body = <SceneProps file={file} />;
    else if (sel?.kind === 'el' && file && doc && el)
      body = (
        <>
          <FormatNote file={file} el={el} />
          <ElementProps key={`${file}#${el.tid}`} file={file} el={el} info={info} />
        </>
      );
    else if (sel?.kind === 'el') body = <div className="empty">这个元素已经不在场景里了。</div>;
    else body = <MotionProps />;
  } else if (slides && sel?.kind === 'el' && file && doc && el && tab !== 'code') {
    body = (
      <>
        <ElementProps key={`${file}#${el.tid}`} file={file} el={el} info={info} />
        <BuildRow file={file} tid={el.tid} />
      </>
    );
  } else if (slides && file && (sel?.kind === 'board' || !sel)) {
    body =
      tab === 'code' ? (
        <>
          <div className="sec">
            <span className="hint">{file}</span>
            <textarea className="code" readOnly value={source ?? ''} style={{ minHeight: 360 }} aria-label="幻灯片源文件" />
            <span className="hint">这是这一页的源文件。改文件（手改、Claude Code、git）后会实时更新。</span>
          </div>
          <JQueryBox file={file} />
        </>
      ) : (
        <SlideProps file={file} />
      );
  } else if (slides && !sel) {
    body = <DeckProps />;
  } else if (sel?.kind === 'el' && file && doc) {
    if (!el) body = <div className="empty">这个元素已经不在设计里了。</div>;
    else if (tab === 'code')
      body = (
        <>
          <CodeTab file={file} doc={doc} el={el} info={info} />
          <JQueryBox file={file} handle={handle} />
        </>
      );
    else if (tab === 'tweaks') body = <Tweaks file={file} doc={doc} />;
    else body = <ElementProps key={`${file}#${el.tid}`} file={file} el={el} info={info} />;
  } else if (sel?.kind === 'board' && file && canvas.boards[file]) {
    if (tab === 'tweaks' && doc) body = <Tweaks file={file} doc={doc} />;
    else if (tab === 'code')
      body = (
        <>
          <div className="sec">
            <span className="hint">{file}</span>
            <textarea className="code" readOnly value={source ?? ''} style={{ minHeight: 360 }} aria-label="画板源文件" />
            <span className="hint">这是画板的源文件。改文件（手改、Claude Code、git）后画布会实时更新。</span>
          </div>
          <JQueryBox file={file} />
        </>
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
        <DsInstall />
        <h3>快捷键</h3>
        <p className="hint" style={{ margin: 0 }}>
          V 选择 · H 抓手 · T 文字 · A 画板 · N 便签 · P 画笔 · R 矩形 · O 椭圆 · L 直线 · ⇧1 适应全部 · ⇧2 缩放到选中 · Esc 取消选中 · ⇧↵ 选中上一级 · ↵ 选中下一级
        </p>
      </div>
    );
  }

  const tabs: { id: typeof tab; label: string }[] = [
    { id: 'props', label: '属性' },
    { id: 'code', label: '代码' },
    ...(slides || motion ? [] : [{ id: 'tweaks' as const, label: 'Tweaks' }]),
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
      {motion ? <MotionLayers /> : slides ? <SlideLayers /> : <LayerTree />}
      <div className="pbody">{body}</div>
    </aside>
  );
}
