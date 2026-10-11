import { useEffect, useRef, type RefObject } from 'react';
import { elementSource, roleOf, rootElement, type FromRuntime } from '@dc/core';
import { display, editElement, parsed, useStore } from '../store';
import { insertHtml } from '../actions';
import { handleKey } from '../shortcuts';

/** Exports waiting for their frame's answer, by request id. */
export const exportWaiters = new Map<string, (r: { dataUrl?: string; error?: string }) => void>();

/** After a move the element's tid changes; find it again by its own source text. */
function follow(file: string, slice: string | null, fallback: number): number {
  const src = display(useStore.getState(), file);
  if (!src || !slice) return fallback;
  const doc = parsed(src);
  return doc.elements.find((e) => src.slice(e.range.start, e.range.end) === slice)?.tid ?? fallback;
}

export interface FrameOptions {
  onReady: () => void;
  /** frame px → screen px */
  scale: () => number;
  /** the text tool's new element, to start retyping once it renders */
  pendingEdit: RefObject<number | null>;
  onWheel?: (m: Extract<FromRuntime, { dc: 'wheel' }>) => void;
  onNavigate?: (target: string) => void;
  onBuilds?: (count: number) => void;
  /** the default inserts a paragraph next to the clicked element */
  textHtml?: string;
}

/**
 * What an artboard or slide frame tells the editor: selection, hover,
 * measurements, retyped text, drags, keys. Edits become ops on `file`.
 */
export function useFrameMessages(file: string, frame: RefObject<HTMLIFrameElement | null>, opts: FrameOptions): void {
  const o = useRef(opts);
  o.current = opts;
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as FromRuntime;
      if (!m || typeof m !== 'object' || !('dc' in m)) return;
      const s = useStore.getState();
      switch (m.dc) {
        case 'ready':
          o.current.onReady();
          break;
        case 'select': {
          if (s.tool === 'text') {
            textTool(m.tid);
            break;
          }
          useStore.setState({ selection: m.tid === null ? { kind: 'board', file } : { kind: 'el', file, tid: m.tid }, menu: null, editingNote: null });
          break;
        }
        case 'inspect':
          if (!m.info || (s.selection?.kind === 'el' && s.selection.file === file)) useStore.setState({ inspect: m.info });
          break;
        case 'counts':
          useStore.setState((st) => ({ counts: { ...st.counts, [file]: m.counts } }));
          break;
        case 'contextmenu': {
          const r = frame.current.getBoundingClientRect();
          const z = o.current.scale();
          useStore.setState({ menu: { x: r.left + m.x * z, y: r.top + m.y * z } });
          break;
        }
        case 'text':
          editElement(file, [{ kind: 'text', tid: m.tid, text: m.text }]);
          break;
        case 'move': {
          const src = display(s, file);
          const slice = src ? elementSource(parsed(src), m.tid) : null;
          if (editElement(file, [{ kind: 'moveTo', tid: m.tid, target: m.target, where: m.where }]))
            useStore.setState({ selection: { kind: 'el', file, tid: follow(file, slice, m.tid) } });
          break;
        }
        case 'dragout': {
          const ops = [{ kind: 'styles' as const, tid: m.tid, set: m.set }];
          if (m.parentTid !== null && Object.keys(m.parentSet).length) ops.push({ kind: 'styles', tid: m.parentTid, set: m.parentSet });
          editElement(file, ops);
          break;
        }
        case 'exported':
          exportWaiters.get(m.id)?.(m);
          exportWaiters.delete(m.id);
          break;
        case 'wheel':
          o.current.onWheel?.(m);
          break;
        case 'key':
          handleKey(m.key, m.meta, m.shift, m.alt);
          break;
        case 'error':
          useStore.setState((st) => (st.runtimeErrors[file] === m.message ? {} : { runtimeErrors: { ...st.runtimeErrors, [file]: m.message } }));
          break;
        case 'navigate': {
          const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
          const href = m.href.split('#')[0];
          o.current.onNavigate?.(href.startsWith('/') ? href.slice(1) : dir + href);
          break;
        }
        case 'builds':
          o.current.onBuilds?.(m.count);
          break;
      }
    };
    const textTool = (tid: number | null) => {
      const src = display(useStore.getState(), file);
      if (!src) return;
      const doc = parsed(src);
      const el = tid === null ? rootElement(doc) : doc.elements[tid];
      if (!el) return;
      const container = ['Group', 'Row', 'Column', 'Grid'].includes(roleOf(el)) && el.tag !== 'sc-for';
      const html = o.current.textHtml ?? '<p style="margin:0;font-size:16px;line-height:1.5">文字</p>';
      const newTid = insertHtml(file, el.tid, container ? 'last' : 'after', html);
      if (newTid !== null) {
        useStore.setState({ selection: { kind: 'el', file, tid: newTid }, tool: 'select' });
        o.current.pendingEdit.current = newTid;
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [file, frame]);
}
