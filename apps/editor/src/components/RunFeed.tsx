import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { elapsed, type AgentStep } from '@dc/core';
import { t } from '../i18n';
import { undo, undoDelegate, useStore, type DelegateEntry, type DelegateState, type FastState } from '../store';
import {
  Chevron,
  Close,
  Done,
  Failed,
  Reuse,
  Spinner,
  StepEdit,
  StepPlan,
  StepRead,
  StepRun,
  StepSay,
  StepSearch,
  Undo,
  UndoAll,
} from './icons';

/**
 * The feed above the prompt: the request just sent, what is happening to it
 * right now, and what came of it. One component for every kind and both
 * agents (the fast model and Claude Code), so the same questions get the
 * same answers everywhere: what did I ask, is it still working and on what,
 * what changed, and how do I take it back. See .design/agent-feedback.md.
 */
/** "12s", "1m 05s" in the language showing. */
function elapsedLabel(ms: number): string {
  const { m, s } = elapsed(ms);
  return m ? t('prompt.elapsed.minutes', { m, ss: String(s).padStart(2, '0') }) : t('prompt.elapsed.seconds', { s });
}

export function RunFeed({ onReuse, onOpen }: { onReuse?: (prompt: string) => void; onOpen?: (file: string) => void }) {
  const lastRun = useStore((s) => s.lastRun);
  const hidden = useStore((s) => s.runHidden);
  const fast = useStore((s) => s.fast);
  const delegate = useStore((s) => {
    const r = s.lastRun;
    return r?.kind === 'delegate' ? s.delegates.find((d) => d.id === r.id) : undefined;
  });

  // while a feed is on screen, finished runs are told here rather than by a toast
  useEffect(() => {
    useStore.setState((s) => ({ feeds: s.feeds + 1 }));
    return () => useStore.setState((s) => ({ feeds: s.feeds - 1 }));
  }, []);

  if (hidden || !lastRun) return null;
  if (lastRun.kind === 'delegate' && delegate) return <DelegateRun d={delegate} onReuse={onReuse} onOpen={onOpen} />;
  if (lastRun.kind === 'fast' && fast.status !== 'idle' && fast.status !== 'delegated') return <FastRun f={fast} onReuse={onReuse} />;
  return null;
}

const close = () => useStore.setState({ runHidden: true });

/** Re-render every second while `on`, for the elapsed time. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/** Keep a scrolling list pinned to its end while it grows, unless the person scrolled up to read. */
function useFollow(ref: RefObject<HTMLElement | null>, dep: unknown) {
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [ref, dep]);
  return () => {
    const el = ref.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
}

function Ask({ text, code }: { text: string; code?: boolean }) {
  return (
    <div className={`run-ask${code ? ' code' : ''}`} title={text}>
      {text}
    </div>
  );
}

function StepIcon({ step }: { step: AgentStep }) {
  switch (step.kind) {
    case 'read':
      return <StepRead />;
    case 'search':
      return <StepSearch />;
    case 'edit':
      return <StepEdit />;
    case 'run':
      return <StepRun />;
    case 'plan':
      return <StepPlan />;
    default:
      return <StepRun />;
  }
}

function Entry({ e, current }: { e: DelegateEntry; current: boolean }) {
  if ('say' in e)
    return (
      <li className="run-say">
        <i>
          <StepSay />
        </i>
        <span>{e.say}</span>
      </li>
    );
  return (
    <li className={`run-step ${e.step.kind}${current ? ' current' : ''}`}>
      <i>{current ? <Spinner /> : <StepIcon step={e.step} />}</i>
      <span>{t(`prompt.step.${e.step.op}`, { target: e.step.target ?? '', within: e.step.within ?? '' })}</span>
    </li>
  );
}

function DelegateRun({ d, onReuse, onOpen }: { d: DelegateState; onReuse?: (p: string) => void; onOpen?: (f: string) => void }) {
  const running = d.state === 'start' || d.state === 'progress';
  const now = useNow(running);
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const onScroll = useFollow(list, d.log.length);
  const showSteps = running || open;
  const last = d.log.at(-1);
  const quiet = running ? Math.floor((now - (last?.at ?? d.startedAt)) / 1000) : 0;
  const took = elapsedLabel((d.endedAt ?? now) - d.startedAt);
  const changed = d.files.filter((f) => !f.startsWith('.'));

  const title = running
    ? d.log.length
      ? 'Claude Code 正在处理'
      : 'Claude Code 正在启动'
    : d.state === 'done'
      ? d.undone
        ? 'Claude Code 的改动已撤销'
        : 'Claude Code 完成'
      : d.state === 'stopped'
        ? '已停止'
        : 'Claude Code 没能完成';

  return (
    <section className={`runfeed ${running ? 'running' : d.state}`} aria-label="Claude Code 的进度" aria-live="polite">
      <Ask text={d.prompt} />
      {d.via === 'fast' && <div className="run-via">快速 AI 判断这件事要读写多个文件，交给了 Claude Code。</div>}
      <header className="run-head">
        <span className="run-state">{running ? <Spinner size={16} /> : d.state === 'done' ? <Done /> : <Failed />}</span>
        <b>{title}</b>
        <span className="run-time">{running ? `已 ${took}` : `用时 ${took}`}</span>
        {!running && d.log.length > 0 && (
          <button className="run-link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {d.log.filter((e) => 'step' in e).length} 步 <Chevron open={open} />
          </button>
        )}
        <span className="run-actions">
          {running ? null : (
            <>
              {Object.keys(d.after).length > 0 && !d.undone && (
                <button className="btn outline sm" onClick={() => undoDelegate(d.id)} title="把这次改过的文件都恢复成改之前的样子">
                  <UndoAll /> 撤销这次改动
                </button>
              )}
              {d.state !== 'done' && onReuse && (
                <button className="btn outline sm" onClick={() => onReuse(d.prompt)} title="把这条请求放回输入框，改一改再发">
                  <Reuse /> 放回输入框
                </button>
              )}
              <button className="ib sm" aria-label="收起" onClick={close}>
                <Close />
              </button>
            </>
          )}
        </span>
      </header>
      {showSteps && (d.log.length > 0 || running) && (
        <ol className="run-steps" ref={list} onScroll={onScroll}>
          {d.log.map((e, i) => (
            <Entry key={i} e={e} current={running && i === d.log.length - 1 && 'step' in e} />
          ))}
          {running && (!last || 'say' in last || quiet >= 8) && (
            <li className="run-wait">
              <i>
                <Spinner />
              </i>
              <span>{!last ? '读请求、准备动手…' : quiet >= 8 ? `在想下一步（${quiet} 秒没有新动作）` : '在想下一步…'}</span>
            </li>
          )}
        </ol>
      )}
      {!running && d.result && <p className={`run-result${d.state === 'done' ? '' : ' bad'}`}>{d.result}</p>}
      {changed.length > 0 && (
        <div className="run-files">
          <span>{running ? '正在改' : d.undone ? '恢复了' : '改了'}</span>
          {changed.map((f) =>
            onOpen ? (
              <button key={f} className="file-chip" onClick={() => onOpen(f)} title={`查看 ${f}`}>
                {f}
              </button>
            ) : (
              <code key={f} className="file-chip">
                {f}
              </code>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function FastRun({ f, onReuse }: { f: FastState; onReuse?: (p: string) => void }) {
  const running = f.status === 'running';
  const now = useNow(running);
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const onScroll = useFollow(list, f.lines.length);
  const canUndo = useStore((s) => f.status === 'done' && !!f.changed && s.undo.at(-1)?.file === f.file);
  const took = f.startedAt ? elapsedLabel((f.endedAt ?? now) - f.startedAt) : '';
  const jq = f.mode === 'jquery';
  // after a retry only the last attempt's statements were kept
  const lastTry = f.lines.slice(f.lines.findLastIndex((l) => l.divider) + 1);
  const statements = lastTry.filter((l) => l.ok);
  const who = jq ? 'jQuery' : '快速 AI';
  const title = running
    ? jq
      ? '正在执行'
      : statements.length
        ? '快速 AI 正在改'
        : '快速 AI 正在读设计'
    : f.status === 'done'
      ? f.changed
        ? '已保存'
        : '没有改动'
      : `${who}没能完成`;
  const showLines = running || open || f.status === 'error';

  return (
    <section className={`runfeed fast ${running ? 'running' : f.status}`} aria-label={`${who}的进度`} aria-live="polite">
      {f.prompt && <Ask text={f.prompt} code={jq} />}
      <header className="run-head">
        <span className="run-state">{running ? <Spinner size={16} /> : f.status === 'done' ? <Done /> : <Failed />}</span>
        <b>{title}</b>
        {took && <span className="run-time">{running ? `已 ${took}` : `用时 ${took}`}</span>}
        {!running && statements.length > 0 && f.status !== 'error' && (
          <button className="run-link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {statements.length} 条语句 <Chevron open={open} />
          </button>
        )}
        <span className="run-actions">
          {running ? null : (
            <>
              {canUndo && (
                <button className="btn outline sm" onClick={undo} title="撤销（⌘Z）">
                  <Undo size={14} /> 撤销
                </button>
              )}
              {f.status === 'error' && !jq && f.prompt && onReuse && (
                <button className="btn outline sm" onClick={() => onReuse(f.prompt!)} title="把这条请求放回输入框，改一改再发">
                  <Reuse /> 放回输入框
                </button>
              )}
              <button className="ib sm" aria-label="收起" onClick={close}>
                <Close />
              </button>
            </>
          )}
        </span>
      </header>
      {showLines && f.lines.length > 0 && (
        <ol className="run-steps code" ref={list} onScroll={onScroll}>
          {f.lines.map((l, i) =>
            l.divider ? (
              <li key={i} className="run-divider">
                {l.code}
              </li>
            ) : (
              <li key={i} className={`run-step${l.ok ? '' : ' bad'}`}>
                <i>{l.ok ? '✓' : '✕'}</i>
                <span>
                  {l.code}
                  {l.error ? `\n${l.error}` : ''}
                </span>
              </li>
            ),
          )}
        </ol>
      )}
      {open && !running && !jq && statements.length > 0 && (
        <button className="run-link" onClick={() => editAsJQuery(f.file, statements.map((l) => l.code).join('\n'))} title="把这些语句放进右侧“代码”里的 jQuery，改一改再执行">
          在 jQuery 里改
        </button>
      )}
      {f.note && <p className={`run-result${f.status === 'error' ? ' bad' : ''}`}>{f.note}</p>}
    </section>
  );
}

/** Hand the fast model's statements to the Code tab's jQuery box, with the file they ran on selected. */
function editAsJQuery(file: string | undefined, code: string) {
  const s = useStore.getState();
  const onFile = s.selection && 'file' in s.selection && s.selection.file === file;
  useStore.setState({
    jqDraft: code,
    panelOpen: true,
    panelTab: 'code',
    ...(file && !onFile ? { selection: { kind: 'board', file } as const } : {}),
  });
}

/** Grow a one-line textarea with what is typed, up to its CSS max-height. */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}
