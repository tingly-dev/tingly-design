import { useTranslation } from 'react-i18next';
import { continuable, setBarCollapsed, useStore, type RunRecord } from '../store';
import { Chevron, Done, Failed, History as HistoryIcon, Reuse, Sparkle, Spinner } from './icons';

/**
 * The parts of the request bar that every kind shares, whether it is the
 * canvas/deck/motion `PromptBar` or the Claude-Code-only `AskClaude`: the fold
 * and history buttons, the pill the bar folds into, the chip that says whether
 * the next request continues a conversation, and the list of earlier requests.
 * See .design/agent-panel.md.
 */

/** History and fold buttons, at the right end of the bar's header. */
export function BarTools() {
  const { t } = useTranslation();
  const open = useStore((s) => s.historyOpen);
  const count = useStore((s) => s.history.length);
  return (
    <span className="bar-tools">
      <button
        className={`ib sm${open ? ' on' : ''}`}
        aria-pressed={open}
        aria-label={t('prompt.history.button')}
        title={t('prompt.history.button')}
        disabled={!count}
        onClick={() => useStore.setState({ historyOpen: !open })}
      >
        <HistoryIcon />
      </button>
      <button className="ib sm" aria-label={t('prompt.bar.fold')} title={t('prompt.bar.fold')} onClick={() => setBarCollapsed(true)}>
        <Chevron />
      </button>
    </span>
  );
}

/** The bar folded to a pill: one click opens it again, and it still says whether a run is going or how it ended. */
export function BarPill() {
  const { t } = useTranslation();
  const lastRun = useStore((s) => s.lastRun);
  const hidden = useStore((s) => s.runHidden);
  const fast = useStore((s) => s.fast);
  const delegate = useStore((s) => (s.lastRun?.kind === 'delegate' ? s.delegates.find((d) => d.id === (s.lastRun as { id: string }).id) : undefined));
  const claude = lastRun?.kind === 'delegate';
  const state: 'idle' | 'running' | 'done' | 'failed' = hidden || !lastRun
    ? 'idle'
    : claude
      ? !delegate
        ? 'idle'
        : delegate.state === 'start' || delegate.state === 'progress'
          ? 'running'
          : delegate.state === 'done'
            ? 'done'
            : 'failed'
      : fast.status === 'running'
        ? 'running'
        : fast.status === 'done'
          ? 'done'
          : fast.status === 'error'
            ? 'failed'
            : 'idle';
  const who = claude ? 'Claude Code' : t('prompt.bar.fastAi');
  const label =
    state === 'idle' ? t('prompt.pill.idle') : state === 'running' ? t('prompt.pill.working', { who }) : state === 'done' ? t('prompt.pill.done', { who }) : t('prompt.pill.failed', { who });
  return (
    <button className={`bar-pill ${state}`} aria-label={`${t('prompt.bar.unfold')}: ${label}`} title={t('prompt.bar.unfold')} onClick={() => setBarCollapsed(false)}>
      {state === 'running' ? <Spinner size={14} /> : state === 'done' ? <Done /> : state === 'failed' ? <Failed /> : <Sparkle />}
      <span>{label}</span>
    </button>
  );
}

/** Whether the next request starts from scratch or continues the last Claude Code conversation. */
export function ContextChip({ target }: { target: 'ai' | 'claude' }) {
  const { t } = useTranslation();
  const last = useStore((s) => continuable(s.delegates));
  const fresh = useStore((s) => s.freshNext);
  if (target === 'ai')
    return (
      <span className="ctx-chip" title={t('prompt.context.fastHint')}>
        {t('prompt.context.fast')}
      </span>
    );
  if (!last) return <span className="ctx-chip" title={t('prompt.context.newOnly')}>{t('prompt.context.new')}</span>;
  const continues = !fresh;
  return (
    <button
      className={`ctx-chip action${continues ? ' continues' : ''}`}
      aria-pressed={continues}
      title={continues ? t('prompt.context.continuesHint') : t('prompt.context.newHint')}
      onClick={() => useStore.setState({ freshNext: continues })}
    >
      {continues ? t('prompt.context.continues', { prompt: last.prompt.replace(/\s+/g, ' ').slice(0, 24) }) : t('prompt.context.new')}
    </button>
  );
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The requests of this editor session, newest first; clicking one puts it back in the prompt box. */
export function HistoryList({ onReuse }: { onReuse?: (prompt: string) => void }) {
  const { t } = useTranslation();
  const history = useStore((s) => s.history);
  const list = [...history].reverse();
  return (
    <section className="run-history" aria-label={t('prompt.history.title')}>
      <header>
        <b>{t('prompt.history.title')}</b>
        <button className="ib sm" aria-label={t('prompt.history.close')} onClick={() => useStore.setState({ historyOpen: false })}>
          <Chevron />
        </button>
      </header>
      {list.length === 0 ? (
        <p className="hint">{t('prompt.history.empty')}</p>
      ) : (
        <ol>
          {list.map((r) => (
            <HistoryRow key={r.id} r={r} onReuse={onReuse} />
          ))}
        </ol>
      )}
    </section>
  );
}

function HistoryRow({ r, onReuse }: { r: RunRecord; onReuse?: (prompt: string) => void }) {
  const { t } = useTranslation();
  return (
    <li className={`hist ${r.state}`}>
      <span className="hist-state" title={t(`prompt.history.${r.state}`)}>
        {r.state === 'running' ? <Spinner size={14} /> : r.state === 'done' ? <Done /> : <Failed />}
      </span>
      <span className="hist-body">
        <span className="hist-prompt" title={r.prompt}>
          {r.prompt}
        </span>
        <span className="hist-meta">
          {time(r.at)} · {t(`prompt.history.${r.agent}`)}
          {r.agent === 'claude' && ` · ${r.continued ? t('prompt.history.continued') : t('prompt.history.new')}`}
        </span>
      </span>
      {onReuse && (
        <button className="ib sm" aria-label={t('prompt.history.reuse')} title={t('prompt.history.reuse')} onClick={() => onReuse(r.prompt)}>
          <Reuse />
        </button>
      )}
    </li>
  );
}
