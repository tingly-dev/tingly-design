/**
 * The fast-edit executor: runs model-written jQuery on an artboard's copy.
 *
 * It lives in an iframe with `sandbox="allow-scripts"` (an opaque origin,
 * no access to the editor, its cookies or its storage) and a CSP that
 * allows no network at all, so the only way out is postMessage.
 */
import jQuery from 'jquery';
import { FastEditSession, type FromExecutor, type ToExecutor } from '@dc/core';

const post = (m: FromExecutor) => window.parent.postMessage(m, '*');

let session: FastEditSession | null = null;
let sessionId = '';

window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  const m = e.data as ToExecutor;
  if (!m || typeof m !== 'object' || !('dc' in m)) return;
  try {
    if (m.dc === 'begin') {
      session = new FastEditSession(m.source, window as Window & typeof globalThis, jQuery, m.others);
      sessionId = m.id;
      post({ dc: 'begun', id: m.id, markup: session.markup() });
    } else if (m.dc === 'run') {
      if (!session || m.id !== sessionId) throw new Error('no session ' + m.id);
      post({ dc: 'result', id: m.id, ...session.run(m.code) });
    } else if (m.dc === 'markup') {
      if (!session || m.id !== sessionId) throw new Error('no session ' + m.id);
      post({ dc: 'markup', id: m.id, markup: session.markup() });
    }
  } catch (err) {
    post({ dc: 'fail', id: (m as { id?: string }).id ?? '', error: (err as Error).message });
  }
});

post({ dc: 'ready' });
