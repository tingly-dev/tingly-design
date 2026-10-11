import { sandboxDoc, type FromExecutor, type StatementResult, type ToExecutor } from '@dc/core';

/**
 * The hidden, sandboxed iframe that runs model-written jQuery. Requests are
 * strictly sequential: one session, one statement at a time.
 */

let frame: HTMLIFrameElement | null = null;
let ready: Promise<void> | null = null;
const waiting = new Map<string, (m: FromExecutor) => void>();
let chain: Promise<unknown> = Promise.resolve();
let seq = 0;

function boot(): Promise<void> {
  if (ready) return ready;
  ready = new Promise<void>((resolve) => {
    frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;border:0;opacity:0;pointer-events:none';
    frame.srcdoc = sandboxDoc(location.origin, 'executor');
    window.addEventListener('message', (e) => {
      if (!frame || e.source !== frame.contentWindow) return;
      const m = e.data as FromExecutor;
      if (m?.dc === 'ready') return resolve();
      if ('id' in m) {
        const fn = waiting.get(m.id);
        if (fn) {
          waiting.delete(m.id);
          fn(m);
        }
      }
    });
    document.body.appendChild(frame);
  });
  return ready;
}

function send(m: ToExecutor): Promise<FromExecutor> {
  const p = chain.then(
    () =>
      new Promise<FromExecutor>((resolve, reject) => {
        const t = setTimeout(() => {
          waiting.delete(m.id);
          reject(new Error('执行器没有响应'));
        }, 10000);
        waiting.set(m.id, (r) => {
          clearTimeout(t);
          resolve(r);
        });
        frame!.contentWindow!.postMessage(m, '*');
      }),
  );
  chain = p.catch(() => {});
  return p;
}

export class ExecSession {
  private constructor(readonly id: string) {}

  static async begin(source: string): Promise<{ session: ExecSession; markup: string }> {
    await boot();
    const id = 's' + ++seq;
    const r = await send({ dc: 'begin', id, source });
    if (r.dc === 'fail') throw new Error(r.error);
    if (r.dc !== 'begun') throw new Error('unexpected executor reply');
    return { session: new ExecSession(id), markup: r.markup };
  }

  async run(code: string): Promise<StatementResult> {
    const r = await send({ dc: 'run', id: this.id, code });
    if (r.dc === 'fail') return { ok: false, source: '', changed: false, error: r.error };
    if (r.dc !== 'result') throw new Error('unexpected executor reply');
    return r;
  }
}

/** Re-run a finished reply on another version of the file (after a save conflict). */
export async function replay(statements: string[], source: string): Promise<string> {
  const { session } = await ExecSession.begin(source);
  let out = source;
  for (const s of statements) {
    const r = await session.run(s);
    if (!r.ok) throw new Error(`改动无法在新版本上重放：${r.error}`);
    out = r.source;
  }
  return out;
}
