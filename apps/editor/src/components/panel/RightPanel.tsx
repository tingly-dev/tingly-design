import { SideResizer } from '../SideResizer';
import { ShortcutLine } from '../Shortcuts';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import { attr } from '@dc/core';
import { display, parsed, useCanvas, useStore } from '../../store';
import { Close } from '../icons';
import { CodeTab } from './CodeTab';
import { ElementProps } from './ElementProps';
import { BoardEmbedProps, isBoardEmbedEl } from './BoardEmbedProps';
import { LayerTree } from './LayerTree';
import { LockNotice } from './LockNotice';
import { lockOf } from '../../layerFlags';
import { BoardProps, ItemProps, Tweaks } from './OtherProps';
import { Field, Row } from './fields';
import { editCanvas } from '../../store';
import { BuildRow, DeckProps, SlideProps } from '../slides/SlidePanel';
import { DsInstall } from './DsInstall';
import { JQueryBox } from './JQueryBox';
import { TemplateValues } from './TemplateValues';
import { AnimRow, FormatNote, MotionLayers, MotionProps, SceneProps } from '../motion/MotionPanel';

/** Layers on top; Properties / Code / Tweaks for whatever is selected below. */
export function RightPanel() {
  const { t } = useTranslation();
  const tab = useStore((s) => s.panelTab);
  const sel = useStore((s) => s.selection);
  const canvas = useCanvas();
  const slides = useStore((s) => s.kind === 'slides');
  const motion = useStore((s) => s.kind === 'motion');
  const isCanvas = useStore((s) => s.kind === 'design');
  // with nothing selected, the Code tab of a deck or a motion piece shows the slide or scene on stage
  const onStage = useStore((s) =>
    s.kind === 'slides' && s.slide ? `slides/${s.slide}.html` : s.kind === 'motion' && s.motionView?.scene ? `scenes/${s.motionView.scene}.html` : null,
  );
  const file = sel?.kind === 'el' || sel?.kind === 'board' ? sel.file : !sel && tab === 'code' ? onStage : null;
  const source = useStore((s) => (file ? display(s, file) : undefined));
  const inspect = useStore((s) => s.inspect);
  const locked = useStore((s) => !!lockOf(s));
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
            <textarea className="code" readOnly value={source ?? ''} style={{ minHeight: 360 }} aria-label={t('panel.source.sceneLabel')} />
            <span className="hint">{t('panel.source.sceneHint')}</span>
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
          {isBoardEmbedEl(el) && <BoardEmbedProps key={`b${file}#${el.tid}`} file={file} el={el} />}
          <ElementProps key={`${file}#${el.tid}`} file={file} el={el} info={info} />
          <AnimRow key={`a${file}#${el.tid}`} file={file} el={el} />
        </>
      );
    else if (sel?.kind === 'el') body = <div className="empty">{t('panel.empty.goneFromScene')}</div>;
    else body = <MotionProps />;
  } else if (slides && sel?.kind === 'el' && file && doc && el && tab !== 'code') {
    body = (
      <>
          {isBoardEmbedEl(el) && <BoardEmbedProps key={`b${file}#${el.tid}`} file={file} el={el} />}
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
            <textarea className="code" readOnly value={source ?? ''} style={{ minHeight: 360 }} aria-label={t('panel.source.slideLabel')} />
            <span className="hint">{t('panel.source.slideHint')}</span>
          </div>
          <JQueryBox file={file} />
        </>
      ) : (
        <SlideProps file={file} />
      );
  } else if (slides && !sel) {
    body = <DeckProps />;
  } else if (sel?.kind === 'el' && file && doc) {
    if (!el) body = <div className="empty">{t('panel.empty.goneFromDesign')}</div>;
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
            <textarea className="code" readOnly value={source ?? ''} style={{ minHeight: 360 }} aria-label={t('panel.source.boardLabel')} />
            <span className="hint">{t('panel.source.boardHint')}</span>
          </div>
          <JQueryBox file={file} />
        </>
      );
    else body = <BoardProps file={file} entry={canvas.boards[file]} />;
  } else if (sel?.kind === 'note' && canvas.notes[sel.id]) {
    body = <ItemProps id={sel.id} note={canvas.notes[sel.id]} />;
  } else {
    body = (
      <>
        <div className="sec">
          <div className="empty" style={{ textAlign: 'center', padding: '8px 0 4px' }}>
            <div style={{ color: 'var(--ink)', fontWeight: 500 }}>{t('panel.empty.nothingSelected')}</div>
            {t('panel.empty.nothingSelectedHint')}
          </div>
          <h3>{t('panel.canvas.title')}</h3>
          <Row label={t('panel.canvas.name')}>
            <Field value={canvas.title} numeric={false} onCommit={(v) => v.trim() && editCanvas((c) => (c.title = v.trim()), `title → ${v.trim()}`)} label={t('panel.canvas.nameLabel')} />
          </Row>
          <p className="hint" style={{ margin: 0 }}>
            {t('panel.canvas.howTo')}
          </p>
        </div>
        {isCanvas && <TemplateValues />}
        <div className="sec">
          <DsInstall />
          <h3>{t('panel.canvas.shortcuts')}</h3>
          <ShortcutLine kind="design" />
        </div>
      </>
    );
  }

  const tabs: { id: typeof tab; label: string }[] = [
    { id: 'props', label: t('panel.tabs.props') },
    { id: 'code', label: t('panel.tabs.code') },
    ...(slides || motion ? [] : [{ id: 'tweaks' as const, label: t('panel.tabs.tweaks') }]),
  ];
  return (
    <aside className="panel" aria-label={t('panel.label')}>
      <SideResizer id="inspector" edge="start" name={t('panel.label')} />
      <div className="tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => useStore.setState({ panelTab: x.id })}>
            {x.label}
          </button>
        ))}
        <button className="ib x" aria-label={t('panel.closeLabel')} title={t('panel.closeTitle')} onClick={() => useStore.setState({ pane: null })}>
          <Close />
        </button>
      </div>
      {motion ? <MotionLayers /> : <LayerTree />}
      <div className="pbody">
        <LockNotice />
        <fieldset className="pset" disabled={locked}>
          {body}
        </fieldset>
      </div>
    </aside>
  );
}
