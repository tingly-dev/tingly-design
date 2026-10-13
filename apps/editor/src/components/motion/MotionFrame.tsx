import { useEffect, useMemo, useRef, useState } from 'react';
import { sandboxDoc, type MotionJson, type SceneWindow } from '@dc/core';
import { SERVER } from '../../base';

export interface MotionInfo {
  width: number;
  height: number;
  /** milliseconds of video, after speed */
  duration: number;
  speed: number;
  fps: number;
  /** in authored time */
  scenes: SceneWindow[];
  issues: { scene: string; message: string; level: string }[];
}

export interface MotionControl {
  seek(t: number): void;
  play(from?: number): void;
  pause(): void;
}

/**
 * A motion project played by the sandbox runtime (packages/sandbox/src/motion.ts)
 * in its own frame, scaled to fit the box it is given. `at` is where it stands
 * after loading: a time, the end, or a still (most of the way through).
 */
export function MotionFrame({
  motion,
  scenes,
  format,
  speed,
  at,
  base,
  box,
  title,
  control,
  onLoaded,
  onTime,
  onEnded,
  onError,
}: {
  motion: MotionJson;
  scenes: Record<string, string>;
  format: string;
  speed?: number;
  at?: number | 'end' | 'still';
  /** where the project's files are served, for relative image paths in scenes */
  base?: string;
  box: { w: number; h: number };
  title: string;
  control?: React.MutableRefObject<MotionControl | null>;
  onLoaded?: (info: MotionInfo) => void;
  onTime?: (t: number) => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [shown, setShown] = useState(false);
  const srcdoc = useMemo(() => sandboxDoc(SERVER, 'motion'), []);
  const cb = useRef({ onLoaded, onTime, onEnded, onError });
  cb.current = { onLoaded, onTime, onEnded, onError };
  const atRef = useRef(at);
  atRef.current = at;

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as { dcm?: string; [k: string]: unknown };
      if (!m || typeof m !== 'object' || typeof m.dcm !== 'string') return;
      if (m.dcm === 'ready') setReady(true);
      else if (m.dcm === 'loaded') {
        setShown(true);
        cb.current.onLoaded?.(m as unknown as MotionInfo);
        if (typeof m.t === 'number') cb.current.onTime?.(m.t);
      } else if (m.dcm === 'time' && typeof m.t === 'number') cb.current.onTime?.(m.t);
      else if (m.dcm === 'ended') cb.current.onEnded?.();
      else if (m.dcm === 'error') cb.current.onError?.(String(m.message ?? ''));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    if (!control) return;
    const post = (m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(m, '*');
    control.current = {
      seek: (t) => post({ dcm: 'seek', t }),
      play: (from) => post({ dcm: 'play', from }),
      pause: () => post({ dcm: 'pause' }),
    };
    return () => {
      control.current = null;
    };
  }, [control]);

  useEffect(() => {
    if (!ready) return;
    frame.current?.contentWindow?.postMessage({ dcm: 'load', motion, scenes, format, speed, at: atRef.current, base }, '*');
  }, [ready, motion, scenes, format, speed, base]);

  const [w, h] = motion.formats[format]?.size ?? [1920, 1080];
  const scale = Math.max(0.01, Math.min(box.w / w, box.h / h));
  return (
    <div className={`mframe${shown ? ' on' : ''}`} style={{ width: w * scale, height: h * scale }}>
      <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        <iframe ref={frame} title={title} sandbox="allow-scripts" srcDoc={srcdoc} tabIndex={-1} />
      </div>
    </div>
  );
}
