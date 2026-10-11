import {
  StatementSplitter,
  buildFastEditPrompt,
  elementLabel,
  logMessage,
  parseDc,
  retryMessage,
  splitStatements,
  attr,
} from '@dc/core';
import { api } from './api';
import { ExecSession, replay } from './executor';
import { canvasOf, display, enqueueResult, toast, useStore, visibleBoards, type FastLine } from './store';

/**
 * The fast in-page editor. A request becomes jQuery statements (written by
 * a model, or typed by the person in jQuery mode) that run one by one on a
 * sandboxed copy of the artboard; after each statement the artboard shows
 * the new source as a draft. When the reply finishes the draft is saved like
 * any other edit — and if the file changed meanwhile, the statements are
 * replayed on the newer version.
 */

const get = useStore.getState;
const set = useStore.setState;

let abort: AbortController | null = null;

function setFast(patch: Partial<ReturnType<typeof get>['fast']>) {
  set((s) => ({ fast: { ...s.fast, ...patch } }));
}
function pushLine(l: FastLine) {
  set((s) => ({ fast: { ...s.fast, lines: [...s.fast.lines, l].slice(-80) } }));
}
function setDraft(file: string, source: string | undefined) {
  set((s) => {
    const drafts = { ...s.drafts };
    if (source === undefined) delete drafts[file];
    else drafts[file] = source;
    return { drafts };
  });
}

export function pointedInfo(file: string, tid: number | null) {
  const src = display(get(), file);
  if (src === undefined || tid === null) return null;
  const el = parseDc(src).elements[tid];
  if (!el) return null;
  const id = attr(el, 'id');
  return {
    handle: id ? '#' + id : '#dc' + tid,
    tag: el.tag,
    label: elementLabel(el),
    snippet: src.slice(el.range.start, Math.min(el.range.end, el.range.start + 1200)),
  };
}

export function cancelFastEdit() {
  abort?.abort();
}

export async function runJQuery(file: string, code: string): Promise<void> {
  const base = display(get(), file);
  if (base === undefined) return;
  const statements = splitStatements(code);
  if (!statements.length) return;
  setFast({ status: 'running', mode: 'jquery', file, prompt: code, lines: [], note: undefined });
  try {
    const { session } = await ExecSession.begin(base);
    let out: string = base;
    const done: string[] = [];
    for (const s of statements) {
      const r = await session.run(s);
      pushLine({ code: s, ok: r.ok, error: r.error });
      if (!r.ok) {
        setDraft(file, undefined);
        setFast({ status: 'error', note: r.error });
        return;
      }
      if (r.log) setFast({ note: r.log });
      done.push(s);
      out = r.source;
      setDraft(file, out);
    }
    setDraft(file, undefined);
    enqueueResult(file, base, out, (src) => replay(done, src), {
      actor: 'jquery',
      summary: `${done.length} 条 jQuery 语句`,
      prompt: code.slice(0, 400),
    });
    setFast({ status: 'done' });
  } catch (e) {
    setDraft(file, undefined);
    setFast({ status: 'error', note: (e as Error).message });
  }
}

export async function delegateToClaude(file: string | undefined, tid: number | null, prompt: string): Promise<void> {
  const project = get().project;
  if (!project) return;
  try {
    const journal = get()
      .journal.slice(-12)
      .map((j) => `- [${j.actor}] ${j.file}: ${j.summary}`);
    await api.delegate(project, {
      prompt,
      file,
      pointed: file ? pointedInfo(file, tid) : null,
      journal,
    });
    setFast({ status: 'delegated', note: '已交给 Claude Code，完成后画布会自动更新。' });
  } catch (e) {
    setFast({ status: 'error', note: (e as Error).message });
  }
}

export async function runFastEdit(file: string, tid: number | null, prompt: string): Promise<void> {
  const s0 = get();
  const project = s0.project;
  const base = display(s0, file);
  if (!project || base === undefined) return;
  setFast({ status: 'running', mode: 'ai', file, prompt, lines: [], note: undefined });
  abort = new AbortController();
  const signal = abort.signal;

  const pointed = pointedInfo(file, tid);
  const nonce = Math.random().toString(36).slice(2, 8);
  let markupOnce: string | null = null;
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  let retries = 0;
  let logRounds = 0;

  try {
    for (;;) {
      const { session, markup } = await ExecSession.begin(base);
      if (markupOnce === null) {
        markupOnce = markup;
        messages.push({
          role: 'user',
          content: buildFastEditPrompt({
            canvas: canvasOf(get()),
            file,
            markup,
            journal: get().journal,
            pointed: pointed ? { handle: pointed.handle, tag: pointed.tag, label: pointed.label } : null,
            visible: visibleBoards(),
            prompt,
            nonce,
          }),
        });
      }
      const res = await api.fastEdit(project, messages, signal);
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((body as { error?: string }).error ?? res.statusText);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      const splitter = new StatementSplitter();
      let reply = '';
      const done: string[] = [];
      const logs: string[] = [];
      let out: string = base;
      let failed: { line: string; error: string } | null = null;
      let delegate = false;

      const runOne = async (st: string): Promise<boolean> => {
        if (/^askClaude\(\s*\)$/.test(st.replace(/;$/, ''))) {
          delegate = true;
          return false;
        }
        const r = await session.run(st);
        pushLine({ code: st, ok: r.ok, error: r.error });
        if (!r.ok) {
          failed = { line: st, error: r.error ?? 'error' };
          return false;
        }
        if (r.log) logs.push(r.log);
        done.push(st);
        if (r.changed) {
          out = r.source;
          setDraft(file, out);
        }
        return true;
      };

      let stop = false;
      while (!stop) {
        const { value, done: end } = await reader.read();
        if (end) break;
        reply += value;
        if (value.includes('__ERROR__')) throw new Error(reply.slice(reply.indexOf('__ERROR__') + 9).trim());
        for (const st of splitter.push(value)) {
          if (!(await runOne(st))) {
            stop = true;
            break;
          }
        }
      }
      if (!stop) for (const st of splitter.flush()) if (!(await runOne(st))) break;
      if (stop) await reader.cancel().catch(() => {});

      if (delegate) {
        setDraft(file, undefined);
        await delegateToClaude(file, tid, prompt);
        return;
      }
      const f = failed as { line: string; error: string } | null;
      if (f) {
        setDraft(file, undefined);
        if (retries++ >= 2) {
          setFast({ status: 'error', note: `三次都没能执行成功：${f.error}` });
          return;
        }
        pushLine({ code: `改动已撤销，第 ${retries} 次重试`, ok: true, divider: true });
        messages.push({ role: 'assistant', content: reply.trim() || '(empty)' }, { role: 'user', content: retryMessage(f.error, f.line) });
        continue;
      }
      if (logs.length && out === base && logRounds++ < 2) {
        messages.push({ role: 'assistant', content: reply.trim() }, { role: 'user', content: logMessage(logs) });
        continue;
      }
      setDraft(file, undefined);
      if (out === base) {
        setFast({ status: 'done', note: '没有产生改动。' });
        return;
      }
      enqueueResult(file, base, out, (src) => replay(done, src), {
        actor: 'fast-edit',
        summary: `${done.length} 条语句`,
        prompt,
      });
      setFast({ status: 'done' });
      return;
    }
  } catch (e) {
    setDraft(file, undefined);
    if ((e as Error).name === 'AbortError') setFast({ status: 'idle', note: '已取消' });
    else {
      setFast({ status: 'error', note: (e as Error).message });
      toast((e as Error).message, 'error');
    }
  } finally {
    abort = null;
  }
}
