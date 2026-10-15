import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { continuable, setBarCollapsed, setBarMode, useStore, type RunRecord } from '../store';
import { Chevron, Done, DockRight, Failed, Floating, History as HistoryIcon, Pin, Pinned, Reuse, Sparkle, Spinner } from './icons';

/** Narrower than this the side dock would take too much of the work, so the bar floats. */
const DOCK_MIN_WIDTH = 1000;

/**
 * Whether the bar is a column on the right edge (hidden until the pointer
 * comes to it, or pinned open) rather than the floating bar. The choice is the
 * person's, remembered and shared by every kind; a narrow window always floats.
 */
export function useDock(): { docked: boolean; mode: 'auto' | 'pinned' | 'float'; wide: boolean } {
  const mode = useStore((s) => s.barMode);
  const [wide, setWide] = useState(() => window.innerWidth >= DOCK_MIN_WIDTH);
  useEffect(() => {
    const q = window.matchMedia(`(min-width: ${DOCK_MIN_WIDTH}px)`);
    const on = () => setWide(q.matches);
    on();
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return { docked: wide && mode !== 'float', mode, wide };
}

/** The bar, as the column when docked (outside the stage's layout, so nothing in a kind's own view moves), else where it is. */
export function DockHost({ docked, children }: { docked: boolean; children: ReactNode }) {
  return docked ? createPortal(children, document.body) : <>{children}</>;
}

/** While the dock is pinned the editor leaves its width to it. */
export function useDockPad(pinned: boolean): void {
  useEffect(() => {
    if (!pinned) return;
    document.documentElement.style.setProperty('--dock-pad', 'var(--dock-w)');
    return () => {
      document.documentElement.style.removeProperty('--dock-pad');
    };
  }, [pinned]);
}

/** Ctrl/⌘ J puts the cursor in the request box, opening the dock or the folded bar on the way; Esc in the box lets an auto-hidden dock go. */
export function useDockKeys(box: RefObject<HTMLTextAreaElement | null>): void {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'j') return;
      e.preventDefault();
      if (useStore.getState().barCollapsed) setBarCollapsed(false);
      requestAnimationFrame(() => box.current?.focus());
    };
    // a click anywhere outside lets an auto-hidden dock go: the canvas may keep focus where it is, so let go of it here
    const letGo = () => {
      const dock = box.current?.closest('.agent-dock.auto');
      if (dock && dock.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    };
    // a click inside an artboard never reaches this document, but it selects something (or moves focus into its frame)
    const away = (e: PointerEvent) => {
      if (!box.current?.closest('.agent-dock')?.contains(e.target as Node)) letGo();
    };
    const unselect = useStore.subscribe((s, prev) => {
      if (s.selection !== prev.selection) letGo();
    });
    window.addEventListener('keydown', on);
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('blur', letGo);
    return () => {
      unselect();
      window.removeEventListener('keydown', on);
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('blur', letGo);
    };
  }, [box]);
}

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
  const { docked, mode, wide } = useDock();
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
      {docked ? (
        <>
          <button
            className={`ib sm${mode === 'pinned' ? ' on' : ''}`}
            aria-pressed={mode === 'pinned'}
            aria-label={mode === 'pinned' ? t('prompt.dock.unpin') : t('prompt.dock.pin')}
            title={mode === 'pinned' ? t('prompt.dock.unpin') : t('prompt.dock.pin')}
            onClick={() => setBarMode(mode === 'pinned' ? 'auto' : 'pinned')}
          >
            {mode === 'pinned' ? <Pinned /> : <Pin />}
          </button>
          <button className="ib sm" aria-label={t('prompt.dock.float')} title={t('prompt.dock.float')} onClick={() => setBarMode('float')}>
            <Floating />
          </button>
        </>
      ) : (
        <>
          {wide && (
            <button className="ib sm" aria-label={t('prompt.dock.dock')} title={t('prompt.dock.dock')} onClick={() => setBarMode('auto')}>
              <DockRight />
            </button>
          )}
          <button className="ib sm" aria-label={t('prompt.bar.fold')} title={t('prompt.bar.fold')} onClick={() => setBarCollapsed(true)}>
            <Chevron />
          </button>
        </>
      )}
    </span>
  );
}

/** What the last run is doing, for the pill and the dock's edge tab. */
export function useRunState(): { state: 'idle' | 'running' | 'done' | 'failed'; claude: boolean } {
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
  return { state, claude };
}

function StateIcon({ state }: { state: 'idle' | 'running' | 'done' | 'failed' }) {
  return state === 'running' ? <Spinner size={14} /> : state === 'done' ? <Done /> : state === 'failed' ? <Failed /> : <Sparkle />;
}

/** The bar folded to a pill: one click opens it again, and it still says whether a run is going or how it ended. */
export function BarPill() {
  const { t } = useTranslation();
  const { state, claude } = useRunState();
  const who = claude ? 'Claude Code' : t('prompt.bar.fastAi');
  const label =
    state === 'idle' ? t('prompt.pill.idle') : state === 'running' ? t('prompt.pill.working', { who }) : state === 'done' ? t('prompt.pill.done', { who }) : t('prompt.pill.failed', { who });
  return (
    <button className={`bar-pill ${state}`} aria-label={`${t('prompt.bar.unfold')}: ${label}`} title={t('prompt.bar.unfold')} onClick={() => setBarCollapsed(false)}>
      <StateIcon state={state} />
      <span>{label}</span>
    </button>
  );
}

/** The dock's handle while it is hidden: always on the edge, it shows a run going, done or failed, and the pointer on it opens the dock. */
export function DockTab() {
  const { t } = useTranslation();
  const { state, claude } = useRunState();
  const who = claude ? 'Claude Code' : t('prompt.bar.fastAi');
  const label = state === 'idle' ? t('prompt.dock.tab') : state === 'running' ? t('prompt.pill.working', { who }) : state === 'done' ? t('prompt.pill.done', { who }) : t('prompt.pill.failed', { who });
  return (
    <button className={`dock-tab ${state}`} aria-label={t('prompt.bar.label')} title={label} tabIndex={-1} onClick={(e) => (e.currentTarget.closest('.agent-dock')?.querySelector('textarea') as HTMLElement | null)?.focus()}>
      <StateIcon state={state} />
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
