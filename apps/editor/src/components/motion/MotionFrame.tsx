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

export interface MotionExportRequest {
  format?: 'auto' | 'mp4' | 'webm' | 'gif';
  scale?: number;
  /** the file's frame size, same aspect ratio as the piece; its own size when left out */
  width?: number;
  height?: number;
  fps?: number;
  quality?: 'low' | 'medium' | 'high';
  /** a stretch of the piece in milliseconds on its timeline (after speed); the whole piece when left out */
  from?: number;
  to?: number;
  fontCss?: string;
  audio?: { data: ArrayBuffer; start: number; gain: number }[];
}

export interface MotionExportResult {
  blob: Blob;
  ext: string;
  container: 'mp4' | 'webm' | 'gif';
  /** Why this is not the MP4 that was asked for, if it is not. */
  note?: 'no-h264' | 'no-aac';
  /** Scenes the in-browser route cannot draw (an embed comes out blank). */
  embeds: string[];
}

export class MotionExportError extends Error {
  constructor(public code: 'aborted' | 'no-encoder' | 'no-stage' | 'failed', message = '') {
    super(message || code);
  }
}

export interface MotionControl {
  seek(t: number): void;
  play(from?: number): void;
  pause(): void;
  /** Render the loaded piece to a video in the frame and hand the file back. */
  exportVideo(req: MotionExportRequest, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<MotionExportResult>;
  /** One frame at time `t` as a PNG, drawn in the frame. */
  snapshot(req: { t: number; scale?: number; fontCss?: string }): Promise<Blob>;
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
  const snaps = useRef(new Map<string, { ok: (b: Blob) => void; fail: (e: Error) => void }>());
  cb.current = { onLoaded, onTime, onEnded, onError };
  const atRef = useRef(at);
  atRef.current = at;
  const exports = useRef(new Map<string, { ok: (r: MotionExportResult) => void; fail: (e: MotionExportError) => void; progress?: (done: number, total: number) => void }>());

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
      else if (m.dcm === 'export-progress') exports.current.get(String(m.id))?.progress?.(Number(m.done), Number(m.total));
      else if (m.dcm === 'exported') exports.current.get(String(m.id))?.ok(m as unknown as MotionExportResult);
      else if (m.dcm === 'export-error') exports.current.get(String(m.id))?.fail(new MotionExportError(m.code as MotionExportError['code'], String(m.message ?? '')));
      else if (m.dcm === 'snapshot-done') snaps.current.get(String(m.id))?.ok(m.blob as Blob);
      else if (m.dcm === 'snapshot-error') snaps.current.get(String(m.id))?.fail(new Error(String(m.message ?? '')));
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
      exportVideo: (req, onProgress, signal) =>
        new Promise((resolve, reject) => {
          const id = Math.random().toString(36).slice(2);
          const done = () => (exports.current.delete(id), signal?.removeEventListener('abort', cancel));
          const cancel = () => post({ dcm: 'export-cancel', id });
          exports.current.set(id, {
            ok: (r) => (done(), resolve(r)),
            fail: (e) => (done(), reject(e)),
            progress: onProgress,
          });
          if (signal?.aborted) return cancel();
          signal?.addEventListener('abort', cancel);
          post({ dcm: 'export', id, ...req });
        }),
      snapshot: (req) =>
        new Promise((resolve, reject) => {
          const id = Math.random().toString(36).slice(2);
          snaps.current.set(id, { ok: (b) => (snaps.current.delete(id), resolve(b)), fail: (e) => (snaps.current.delete(id), reject(e)) });
          post({ dcm: 'snapshot', id, ...req });
        }),
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
