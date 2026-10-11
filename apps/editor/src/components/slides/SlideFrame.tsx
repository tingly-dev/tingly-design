import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { deckFontFaces, deckFontLinks, sandboxDoc, SLIDE_H, SLIDE_W, type SlideRender, type ToRuntime } from '@dc/core';
import { display, deckOf, useStore } from '../../store';
import { frames } from '../Board';
import { useFrameMessages } from '../frame';

export function useSlideRender(still: boolean): SlideRender {
  const project = useStore((s) => s.project);
  const deck = useStore((s) => deckOf(s));
  return useMemo(
    () => ({
      fonts: deckFontLinks(deck),
      faces: deckFontFaces(deck),
      base: `${location.origin}/api/projects/${encodeURIComponent(project ?? '')}/raw/`,
      still,
    }),
    [deck, project, still],
  );
}

interface Props {
  file: string;
  /** frame px → screen px */
  scale: number;
  /** the editable stage: selection, retyping, drags (one per file at a time) */
  interactive?: boolean;
  mode?: 'edit' | 'play';
  /** thumbnails: no live embeds */
  still?: boolean;
  /** present: builds shown */
  step?: number;
  onBuilds?: (count: number) => void;
  label?: string;
}

/**
 * One slide in a sandboxed frame, drawn at 1920×1080 and scaled to fit. The
 * stage frame is interactive (it is the artboard runtime, so selection,
 * retyping and drags work as on the design canvas); thumbnails and the
 * presenter's frames are not.
 */
export const SlideFrame = memo(function SlideFrame({ file, scale, interactive = false, mode = 'edit', still = false, step = 0, onBuilds, label }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const pendingEdit = useRef<number | null>(null);
  const source = useStore((s) => display(s, file));
  const selected = useStore((s) => (interactive && s.selection?.kind === 'el' && s.selection.file === file ? s.selection.tid : null));
  const hover = useStore((s) => (interactive && s.layerHover?.file === file ? s.layerHover.tid : null));
  const slide = useSlideRender(still);
  const srcdoc = useMemo(() => sandboxDoc(location.origin, 'runtime'), []);
  const pending = useStore((s) => (interactive ? s.pendingSlideEdit : null));

  useEffect(() => {
    if (!interactive) return;
    const el = frame.current;
    if (el) frames.set(file, el);
    return () => {
      if (frames.get(file) === el) frames.delete(file);
    };
  }, [file, interactive]);

  useFrameMessages(file, frame, {
    onReady: () => setReady(true),
    scale: () => scale,
    pendingEdit,
    onBuilds,
    textHtml: '<p style="font-size:32px;line-height:1.4">文字</p>',
  });

  const post = (m: ToRuntime) => frame.current?.contentWindow?.postMessage(m, '*');

  useEffect(() => {
    if (!ready || source === undefined) return;
    post({ dc: 'render', file, source, files: {}, props: {}, mode, selected, slide });
    const p = pendingEdit.current ?? (pending && pending.file === file ? pending.tid : null);
    if (p !== null) {
      post({ dc: 'edit', tid: p });
      pendingEdit.current = null;
      if (pending) useStore.setState({ pendingSlideEdit: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, source, mode, file, selected, slide, pending]);

  useEffect(() => {
    if (ready && interactive) post({ dc: 'hover', tid: hover });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hover, interactive]);

  useEffect(() => {
    if (ready && mode === 'play') post({ dc: 'build', step });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, step, mode, source]);

  return (
    <div className="slide-frame" style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}>
      <iframe
        ref={frame}
        title={label ?? file}
        sandbox="allow-scripts allow-popups"
        srcDoc={srcdoc}
        tabIndex={interactive ? 0 : -1}
        style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${scale})`, pointerEvents: interactive ? 'auto' : 'none' }}
      />
    </div>
  );
});
