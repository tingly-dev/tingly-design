/**
 * The template renderer: draws the artboard's source with React into the
 * frame, keeps the slide subset's base styles and the deck's typefaces in the
 * document head, and remembers which source is actually on screen.
 */
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { HIDE_CSS, SLIDE_BASE_CSS, timeSpec, boardTime, sceneBaseCss, type FromRuntime } from '@dc/core';
import { BUILD_CSS, showSteps } from './slide';
import { answerPptxCapture } from './pptxCapture';
import { post } from './post';
import { current, mount } from './stage';
import { clearSceneAnim, animate, MOTION_CSS } from './scene';
import { Boundary, DcComponent, docFor } from './template';

const root = createRoot(mount);
let renderKey = 0;
/** The source whose DOM is actually on screen (React commits asynchronously). */
export let committedSource = '';

/** Draw again with a fresh Boundary key (after a refused retype, a mode switch). */
export function rerender(): void {
  renderKey++;
  render();
}

// hidden elements go everywhere, canvas artboards included (slides and scenes carry it in SLIDE_BASE_CSS)
document.head.appendChild(Object.assign(document.createElement('style'), { textContent: HIDE_CSS }));
answerPptxCapture(mount, () => committedSource);

let boardReady = false;
function Committed({ source }: { source: string }) {
  React.useLayoutEffect(() => {
    committedSource = source;
    if (!boardReady && window.parent !== window && !current.slide && timeSpec(docFor(source).props)) {
      // a moving artboard inside an embed: its host may seek it now
      boardReady = true;
      post({ dcMotion: 'embed-ready' } as unknown as FromRuntime);
    }
    if (current.slide && current.mode === 'play') post({ dc: 'steps', total: showSteps(mount, current.step) });
  }, [source]);
  return null;
}

// slides: the subset's base styles once, the deck's typefaces whenever they change
let slideStyles: HTMLStyleElement | null = null;
let facesHtml = '';
function slideHead() {
  if (!slideStyles) {
    slideStyles = document.createElement('style');
    document.head.appendChild(slideStyles);
  }
  const size = current.motion?.size ?? current.slide?.size;
  const css =
    (size ? sceneBaseCss(size[0], size[1], SLIDE_BASE_CSS) : SLIDE_BASE_CSS) + (current.motion ? MOTION_CSS : BUILD_CSS) + 'html,body{background:transparent;overflow:hidden}';
  if (slideStyles.textContent !== css) slideStyles.textContent = css;
  const html = current.slide?.head ?? '';
  if (html !== facesHtml) {
    facesHtml = html;
    // only font links and @font-face rules ever come here (deck.ts faceMarkup)
    const holder = document.createElement('template');
    holder.innerHTML = html;
    document.head.querySelectorAll('[data-dc-face]').forEach((n) => n.remove());
    for (const n of Array.from(holder.content.children)) {
      if (n.tagName !== 'LINK' && n.tagName !== 'STYLE') continue;
      n.setAttribute('data-dc-face', '');
      document.head.appendChild(n);
    }
  }
}

export function render() {
  const doc = docFor(current.source);
  post({ dc: 'error', message: doc.errors.length ? doc.errors.join('\n') : null });
  if (doc.slide) slideHead();
  // an artboard that declares $time draws from a time prop: the one its host sought, else what the editor set, else its still
  const spec = doc.slide ? null : timeSpec(doc.props);
  const props = spec ? { ...current.props, time: boardTime(spec, current.time ?? (current.props.time as number | undefined)) } : current.props;
  const body = <DcComponent key={current.source} source={current.source} file={current.file} props={props} ctx={current.ctx()} />;
  const tree = (
    <Boundary key={renderKey} file={current.file}>
      {doc.slide ? <div className="dc-slide-host">{body}</div> : body}
      <Committed source={current.source} />
    </Boundary>
  );
  if (!current.motion) return root.render(tree);
  // a scene's animations hold the page in a state React didn't write: put it back first,
  // and commit at once so no frame shows the scene without its timing
  clearSceneAnim();
  flushSync(() => root.render(tree));
  animate();
}
