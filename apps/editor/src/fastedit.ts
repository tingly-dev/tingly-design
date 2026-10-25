import {
  StatementSplitter,
  deckSize,
  buildFastEditPrompt,
  elementLabel,
  logMessage,
  parseDc,
  retryMessage,
  splitStatements,
  attr,
  attachmentBlocks,
  attachmentSummary,
  checkScene,
  checkSlide,
  sceneFile,
  sceneIdOf,
  sceneTiming,
  type Attachment,
  type ModelMessage,
  sectionsOf,
  slideFile,
  slideIdOf,
  describeChange,
} from '@dc/core';
import { api } from './api';
import { t } from './i18n';
import { ExecSession, replay } from './executor';
import { canvasOf, deckOf, display, enqueueResult, slideIds, toast, useStore } from './store';
import type { FastLine, LastRun } from './store/agent';
import { visibleBoards } from './components/canvas/view';
import { slideTitle } from './components/slides/slides';
import { motionOf } from './components/motion/motion';

/** A deck's outline for the model: sections and slide titles, the current one marked. */
function deckOutline(file: string): string {
  const s = get();
  const deck = deckOf(s);
  const ids = slideIds(s);
  const lines = [`"${deck.title}", ${ids.length} slides, ${deckSize(deck).join('×')} each`];
  let n = 0;
  for (const g of sectionsOf(deck, ids)) {
    if (g.description) lines.push(`section: ${g.description}`);
    for (const id of g.ids) {
      n++;
      lines.push(`- ${n}. ${slideFile(id)}${slideFile(id) === file ? ' (this one)' : ''}: ${slideTitle(display(s, slideFile(id)), id)}`);
    }
  }
  return lines.join('\n');
}

/** Subset errors a reply introduced (ones the slide already had are not the reply's). */
function newSlideErrors(file: string, before: string, after: string): string[] {
  const scene = sceneIdOf(file);
  const id = slideIdOf(file) ?? scene;
  if (!id) return [];
  const check = (src: string) => (scene ? checkScene(parseDc(src), scene) : checkSlide(parseDc(src), id));
  const known = new Set(check(before).map((i) => i.message));
  return check(after)
    .filter((i) => i.level === 'error' && !known.has(i.message))
    .map((i) => i.message);
}

/** A motion piece for the model: its sizes, the scenes with their length, where the playhead is. */
function motionOutline(file: string): string {
  const s = get();
  const m = motionOf(s);
  const view = s.motionView;
  const fmts = Object.entries(m.formats).map(([n, f], i) => `${n} ${f.size.join('×')}${i === 0 ? ' (primary: style is its look)' : ''}`);
  const lines = [`"${m.title}", a motion piece. Formats: ${fmts.join(', ')}.`];
  if (view) lines.push(`The person is looking at the ${view.format} format${view.scene ? (view.landed ? `, at the start of scene ${view.scene}, with every element drawn where it lands` : `, ${(view.at / 1000).toFixed(2)}s into scene ${view.scene}`) : ''}.`);
  if (m.note) lines.push(`Note on the whole piece (the person's words, context only): ${JSON.stringify(m.note.slice(0, 600))}`);
  lines.push('Scenes in order:');
  m.order.forEach((id, i) => {
    const t = sceneTiming(display(s, sceneFile(id)) ?? '');
    lines.push(`- ${i + 1}. ${sceneFile(id)}${sceneFile(id) === file ? ' (this one)' : ''}: ${t.duration ?? '4s'}${t.transition ? `, leaves with ${t.transition}` : ''}`);
  });
  return lines.join('\n');
}

/**
 * The fast in-page editor. A request becomes jQuery statements (written by
 * a model, or typed by the person in the Code tab's jQuery box) that run one by one on a
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
  setFast({ status: 'running', mode: 'jquery', file, prompt: code, lines: [], note: undefined, startedAt: Date.now(), endedAt: undefined, changed: false });
  set({ lastRun: { kind: 'fast' }, runHidden: false });
  try {
    const { session } = await ExecSession.begin(base);
    let out: string = base;
    const done: string[] = [];
    for (const s of statements) {
      const r = await session.run(s);
      pushLine({ code: s, ok: r.ok, error: r.error });
      if (!r.ok) {
        setDraft(file, undefined);
        setFast({ status: 'error', note: r.error, endedAt: Date.now() });
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
      summary: t('app.journal.jqStatements', { count: done.length }),
      prompt: code.slice(0, 400),
    });
    setFast({ status: 'done', endedAt: Date.now(), changed: out !== base });
  } catch (e) {
    setDraft(file, undefined);
    setFast({ status: 'error', note: (e as Error).message, endedAt: Date.now() });
  }
}

/** Stop a run: the one named, or the one the feed shows. */
export function stopRun(run: LastRun = get().lastRun): void {
  const s = get();
  if (run?.kind === 'fast') return cancelFastEdit();
  if (run?.kind === 'delegate' && s.project) void api.stopDelegate(s.project, run.id).catch((e) => toast((e as Error).message, 'error'));
}

export interface DelegateOptions {
  /** what the person was looking at, told to Claude Code before the request but not shown as part of it */
  context?: string;
  /** the fast model handed the request over */
  via?: 'fast';
}

/** Hand a request to Claude Code. False when it could not start (the request is then still the person's to resend). */
export async function delegateToClaude(
  file: string | undefined,
  tid: number | null,
  prompt: string,
  attachments: Attachment[] = [],
  opts: DelegateOptions = {},
): Promise<boolean> {
  const project = get().project;
  if (!project) return false;
  // said before the request goes out: the run's first event can arrive before the reply naming it
  if (opts.via) setFast({ status: 'delegated', note: undefined });
  try {
    const journal = get()
      .journal.slice(-12)
      .map((j) => `- [${j.actor}] ${j.file}: ${j.summary}`);
    // a motion piece: where the person stopped, so "this" and "here" mean something; told to Claude Code, not echoed as the request
    const view = get().kind === 'motion' ? get().motionView : null;
    const where = view?.scene ? view.landed ? `Stopped at the start of scene ${view.scene} (looking at the whole page as it lands), viewing the ${view.format} format.` : `Stopped at ${(view.at / 1000).toFixed(1)} s into scene ${view.scene}, viewing the ${view.format} format.` : '';
    // settings the person changed by hand since the last run: Claude Code is told, whether or not they took the offer
    const changed = get().changes;
    const changes = changed.length ? `Settings the person changed since your last run:\n${changed.map((c) => `- ${describeChange(c)}`).join('\n')}` : '';
    const context = [where, changes, opts.context].filter(Boolean).join('\n\n');
    // the server continues the project's conversation unless the request says otherwise: a hand-over from fast AI brings its own context, and a person can ask for a new one
    const fresh = !!opts.via || get().freshNext;
    const { id } = await api.delegate(project, {
      prompt,
      ...(fresh ? { fresh: true } : {}),
      ...(opts.via ? { via: opts.via } : {}),
      ...(context ? { context } : {}),
      file,
      pointed: file ? pointedInfo(file, tid) : null,
      journal,
      ...(attachments.length ? { attachments: attachments.filter((a) => a.path).map((a) => ({ name: a.name, path: a.path })) } : {}),
    });
    // only what this request told Claude Code: a change made while it was being sent waits for the next one
    set((s) => ({ freshNext: false, changes: s.changes.filter((c) => !changed.includes(c)), followUp: s.followUp && changed.includes(s.followUp) ? null : s.followUp }));
    if (opts.via) set((s) => ({ delegates: s.delegates.map((d) => (d.id === id ? { ...d, via: opts.via } : d)) }));
    return true;
  } catch (e) {
    toast(t('app.fast.delegateFailed', { error: (e as Error).message }), 'error');
    return false;
  }
}


export async function runFastEdit(file: string, tid: number | null, prompt: string, attachments: Attachment[] = []): Promise<void> {
  const s0 = get();
  const project = s0.project;
  const base = display(s0, file);
  if (!project || base === undefined) return;
  setFast({ status: 'running', mode: 'ai', file, prompt, lines: [], note: undefined, startedAt: Date.now(), endedAt: undefined, changed: false });
  set({ lastRun: { kind: 'fast' }, runHidden: false });
  abort = new AbortController();
  const signal = abort.signal;

  const pointed = pointedInfo(file, tid);
  const nonce = Math.random().toString(36).slice(2, 8);
  let markupOnce: string | null = null;
  const messages: ModelMessage[] = [];
  let retries = 0;
  let logRounds = 0;

  try {
    for (;;) {
      const { session, markup } = await ExecSession.begin(base);
      if (markupOnce === null) {
        markupOnce = markup;
        const text = buildFastEditPrompt({
          ...(get().kind === 'slides' ? { outline: deckOutline(file) } : get().kind === 'motion' ? { outline: motionOutline(file) } : { canvas: canvasOf(get()) }),
          file,
          markup,
          journal: get().journal,
          pointed: pointed ? { handle: pointed.handle, tag: pointed.tag, label: pointed.label } : null,
          visible: visibleBoards(),
          prompt,
          nonce,
          attachments: attachments.length ? attachmentSummary(attachments) : undefined,
        });
        // the files come first, the request that refers to them last
        messages.push({ role: 'user', content: attachments.length ? [...attachmentBlocks(attachments, nonce), { type: 'text', text }] : text });
      }
      const res = await api.fastEdit(project, messages, signal, get().kind ?? undefined);
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
        if (!(await delegateToClaude(file, tid, prompt, attachments, { via: 'fast' }))) setFast({ status: 'error', note: t('app.fast.handOffFailed'), endedAt: Date.now() });
        return;
      }
      const f = failed as { line: string; error: string } | null;
      if (f) {
        setDraft(file, undefined);
        if (retries++ >= 2) {
          setFast({ status: 'error', note: t('app.fast.threeFailures', { error: f.error }), endedAt: Date.now() });
          return;
        }
        pushLine({ code: t('app.fast.retry', { n: retries }), ok: true, divider: true });
        messages.push({ role: 'assistant', content: reply.trim() || '(empty)' }, { role: 'user', content: retryMessage(f.error, f.line) });
        continue;
      }
      if (logs.length && out === base && logRounds++ < 2) {
        messages.push({ role: 'assistant', content: reply.trim() }, { role: 'user', content: logMessage(logs) });
        continue;
      }
      const broke = (get().kind === 'slides' || get().kind === 'motion') && out !== base ? newSlideErrors(file, base, out) : [];
      if (broke.length && retries < 2) {
        retries++;
        setDraft(file, undefined);
        pushLine({ code: t('app.fast.retrySlide', { n: retries }), ok: true, divider: true });
        messages.push(
          { role: 'assistant', content: reply.trim() || '(empty)' },
          { role: 'user', content: `That reply was undone: the slide no longer fits the slide subset:\n${broke.map((m) => `- ${m}`).join('\n')}\nWrite the whole reply again so the slide stays inside the subset.` },
        );
        continue;
      }
      setDraft(file, undefined);
      if (out === base) {
        setFast({ status: 'done', note: t('app.fast.noChange'), endedAt: Date.now() });
        return;
      }
      enqueueResult(file, base, out, (src) => replay(done, src), {
        actor: 'fast-edit',
        summary: t('app.journal.statements', { count: done.length }),
        prompt,
      });
      setFast({ status: 'done', endedAt: Date.now(), changed: true });
      return;
    }
  } catch (e) {
    setDraft(file, undefined);
    if ((e as Error).name === 'AbortError') setFast({ status: 'error', note: t('app.fast.stopped'), endedAt: Date.now() });
    else {
      setFast({ status: 'error', note: (e as Error).message, endedAt: Date.now() });
      toast((e as Error).message, 'error');
    }
  } finally {
    abort = null;
  }
}
