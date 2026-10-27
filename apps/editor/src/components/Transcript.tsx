import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Turn } from '@dc/core';
import { stopRun } from '../fastedit';
import { undo, undoDelegate, useStore } from '../store';
import { useTurns } from '../turns';
import { ArrowDown, Chevron, Done, Failed, Reuse, Spinner, Undo, UndoAll } from './icons';
import { elapsedLabel, Entry, RunFiles, useNow } from './RunFeed';

/**
 * The conversation of a project: every request, what the agent did about it, what it answered
 * and which files it changed, oldest first. The left column shows all of it (`Transcript`), the
 * history above the bottom bar shows the same turns as rows (`TurnBody` under each). One
 * component draws a turn whether it is running or long over. See .design/chat-panel.md.
 */

type Actions = {
  /** show a file the turn changed */
  onOpen?: (file: string) => void;
  /** put the request back in the box */
  onReuse?: (prompt: string) => void;
};

/** What the turn is doing or how it ended, in the agent's words. */
function useTitle(turn: Turn): string {
  const { t } = useTranslation();
  const undone = useStore((s) => !!s.delegates.find((d) => d.id === turn.id)?.undone);
  if (turn.agent === 'fast') {
    if (turn.state === 'running') return turn.steps.length ? t('prompt.run.fastEditing') : t('prompt.run.fastReading');
    if (turn.state === 'error') return t('prompt.run.fastFailed');
    return turn.files.length ? t('prompt.run.saved') : t('prompt.run.noChange');
  }
  if (turn.state === 'running') return turn.steps.length ? t('prompt.run.claudeWorking') : t('prompt.run.claudeStarting');
  if (turn.state === 'stopped') return t('prompt.run.stopped');
  if (turn.state === 'error') return t('prompt.run.claudeFailed');
  return undone ? t('prompt.run.claudeUndone') : t('prompt.run.claudeDone');
}

/** Everything about a turn except the request: the state line, the steps, the answer and the files. */
export function TurnBody({ turn, latest, onOpen, onReuse }: { turn: Turn } & Actions & { latest?: boolean }) {
  const { t } = useTranslation();
  const running = turn.state === 'running';
  const now = useNow(running);
  const [open, setOpen] = useState(false);
  const title = useTitle(turn);
  const stepCount = turn.steps.filter((e) => !('omitted' in e)).length;
  const fast = turn.agent === 'fast';
  const took = turn.endedAt || running ? elapsedLabel(t, (turn.endedAt ?? now) - turn.startedAt) : '';
  const last = turn.steps.at(-1);
  const quiet = running ? Math.floor((now - (last && 'at' in last ? last.at : turn.startedAt)) / 1000) : 0;
  const changed = turn.files.filter((f) => !f.startsWith('.'));
  const answer = turn.state === 'stopped' ? t('prompt.run.stoppedNote') : turn.answer;

  // the newest turn can take its changes back while nothing newer has touched them
  const undoKind = useStore((s): 'claude' | 'fast' | null => {
    if (!latest || running) return null;
    const d = s.delegates.find((x) => x.id === turn.id);
    if (d) return d.undone || !Object.keys(d.after).length ? null : 'claude';
    if (turn.id === `fast-${s.fast.startedAt}` && s.fast.status === 'done' && s.fast.changed && s.undo.at(-1)?.file === s.fast.file) return 'fast';
    return null;
  });
  const undoable = undoKind ? () => (undoKind === 'fast' ? undo() : undoDelegate(turn.id)) : null;

  return (
    <div className={`runfeed turn-body${fast ? ' fast' : ''} ${running ? 'running' : turn.state}`}>
      {turn.via === 'fast' && <div className="run-via">{t('prompt.run.viaFast')}</div>}
      <div className="run-head">
        <span className="run-state">{running ? <Spinner size={16} /> : turn.state === 'done' ? <Done /> : <Failed />}</span>
        <b>{title}</b>
        {took && <span className="run-time">{running ? t('prompt.run.elapsedSoFar', { took }) : t('prompt.run.took', { took })}</span>}
        {!running && stepCount > 0 && (
          <button className="run-link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {fast ? t('prompt.run.statements', { count: stepCount }) : t('prompt.run.steps', { count: stepCount })} <Chevron open={open} />
          </button>
        )}
        {running && (
          <button className="btn outline sm run-stop" onClick={() => stopRun(fast ? { kind: 'fast' } : { kind: 'delegate', id: turn.id })}>
            {t('common.stop')}
          </button>
        )}
      </div>
      {running && last && (
        <ol className="run-steps folded">
          <Entry e={last} current={'step' in last} />
          {('say' in last || quiet >= 8) && (
            <li className="run-wait">
              <i>
                <Spinner />
              </i>
              <span>{quiet >= 8 ? t('prompt.run.thinkingQuiet', { count: quiet }) : t('prompt.run.thinking')}</span>
            </li>
          )}
        </ol>
      )}
      {running && !last && (
        <ol className="run-steps folded">
          <li className="run-wait">
            <i>
              <Spinner />
            </i>
            <span>{t('prompt.run.preparing')}</span>
          </li>
        </ol>
      )}
      {open && !running && (
        <ol className={`run-steps${fast ? ' code' : ''}`}>
          {turn.steps.map((e, i) => (
            <Entry key={i} e={e} current={false} />
          ))}
        </ol>
      )}
      {!running && (answer ? <p className={`run-result${turn.state === 'done' ? '' : ' bad'}`}>{answer}</p> : null)}
      {changed.length > 0 && <RunFiles changed={changed} label={running ? t('prompt.run.filesChanging') : t('prompt.run.filesChanged')} onOpen={onOpen} />}
      {!running && (undoable || onReuse) && (
        <div className="run-actions turn-actions">
          {undoable && (
            <button className="btn outline sm" onClick={undoable} title={t('prompt.run.undoAllHint')}>
              {turn.agent === 'fast' ? <Undo size={14} /> : <UndoAll />} {t('prompt.chat.undoRun')}
            </button>
          )}
          {onReuse && (
            <button className="btn ghost sm" onClick={() => onReuse(turn.prompt)} title={t('prompt.run.reuseHint')}>
              <Reuse /> {t('prompt.run.reuse')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Who and where a request came from, when it was not typed in this editor. */
function SourceBadge({ turn }: { turn: Turn }) {
  const { t } = useTranslation();
  if (turn.source === 'editor') return null;
  return <span className="turn-source">{turn.source === 'cli' ? t('prompt.chat.fromCli') : t('prompt.chat.fromMcp')}</span>;
}

function TurnView({ turn, latest, first, ...actions }: { turn: Turn; latest: boolean; first: boolean } & Actions) {
  const { t } = useTranslation();
  return (
    <article className="turn" data-turn={turn.id} data-state={turn.state}>
      {!first && turn.agent === 'claude' && turn.continued === false && <div className="turn-divider">{t('prompt.chat.newConversation')}</div>}
      <div className="turn-ask">
        <div className="turn-who">
          <SourceBadge turn={turn} />
          <span>{turn.agent === 'fast' ? t('prompt.chat.fast') : t('prompt.chat.claude')}</span>
        </div>
        <div className="turn-bubble">{turn.prompt}</div>
      </div>
      <TurnBody turn={turn} latest={latest} {...actions} />
    </article>
  );
}

/** The column's body: the turns, following the newest one unless the person scrolled up to read. */
export function Transcript({ onOpen, onReuse, hidden }: Actions & { hidden?: boolean }) {
  const { t } = useTranslation();
  const turns = useTurns();
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [away, setAway] = useState(false);
  const [fresh, setFresh] = useState(false);
  const last = turns.at(-1);
  // what changes as the newest turn goes: a step, its end, its answer
  const mark = `${turns.length}:${last?.steps.length ?? 0}:${last?.state}:${last?.answer?.length ?? 0}`;

  // while a feed is on screen, finished runs are told here rather than by a toast
  useEffect(() => {
    useStore.setState((s) => ({ feeds: s.feeds + 1 }));
    return () => useStore.setState((s) => ({ feeds: s.feeds - 1 }));
  }, []);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || hidden) return;
    if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [mark, hidden]);

  const prevState = useRef(last?.state);
  useEffect(() => {
    if (prevState.current === 'running' && last && last.state !== 'running' && !pinned.current) setFresh(true);
    prevState.current = last?.state;
  }, [last]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAway(!pinned.current);
    if (pinned.current) setFresh(false);
  };
  const jump = () => {
    const el = box.current;
    if (!el) return;
    pinned.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setAway(false);
    setFresh(false);
  };

  return (
    <div className="chat-feed-wrap" hidden={hidden}>
      <div className="chat-feed" ref={box} onScroll={onScroll} role="log" aria-live="polite" aria-label={t('prompt.chat.label')}>
        {turns.length === 0 ? (
          <p className="chat-empty">{t('prompt.chat.empty')}</p>
        ) : (
          turns.map((turn, i) => <TurnView key={turn.id} turn={turn} latest={i === turns.length - 1} first={i === 0} onOpen={onOpen} onReuse={onReuse} />)
        )}
      </div>
      {away && (
        <button className={`chat-jump${fresh ? ' fresh' : ''}`} onClick={jump} title={fresh ? t('prompt.chat.jumpNew') : t('prompt.chat.jump')}>
          <ArrowDown /> {t('prompt.chat.jump')}
        </button>
      )}
    </div>
  );
}
