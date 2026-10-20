import { useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { Turn } from '@dc/core';
import { SIDES } from '../sideWidth';
import { setBarCollapsed, setBarMode, useStore } from '../store';
import { useTurns } from '../turns';
import { MIN_WORK, useChat } from './ChatPanel';
import { Menu, MenuItem } from './Menu';
import { TurnBody } from './Transcript';
import { Chevron, Done, DockBottom, DockLeft, Failed, History as HistoryIcon, Reuse, Sparkle, Spinner } from './icons';

/** Ctrl/⌘ J puts the cursor in the request box, opening the folded bar on the way; a click on the work lets go of the box, which folds the run card of the floating bar. */
export function useBarKeys(box: RefObject<HTMLTextAreaElement | null>): void {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'j') return;
      e.preventDefault();
      if (useStore.getState().barCollapsed) setBarCollapsed(false);
      requestAnimationFrame(() => box.current?.focus());
    };
    // a click anywhere outside lets go of the box of the floating bar: the canvas may keep focus where it is, so let go of it here
    const letGo = () => {
      const bar = box.current?.closest('.prompt:not(.chat-composer), .dsask:not(.chat-composer)');
      if (bar && bar.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    };
    // a click inside an artboard never reaches this document, but it selects something (or moves focus into its frame)
    const away = (e: PointerEvent) => {
      if (!box.current?.closest('.prompt, .dsask')?.contains(e.target as Node)) letGo();
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

/** The position menu, history and fold buttons, at the right end of the bar's header. */
export function BarTools() {
  const { t } = useTranslation();
  const open = useStore((s) => s.historyOpen);
  const count = useStore((s) => s.turns.length + s.delegates.length);
  const { left } = useChat();
  return (
    <span className="bar-tools">
      {!left && (
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
      )}
      <PositionMenu />
      {!left && (
        <button className="ib sm" aria-label={t('prompt.bar.fold')} title={t('prompt.bar.fold')} onClick={() => setBarCollapsed(true)}>
          <Chevron />
        </button>
      )}
    </span>
  );
}

/** Where the request bar sits: the bottom of the work, or a column on the left. One menu, two items, each saying what it costs. */
function PositionMenu() {
  const { t } = useTranslation();
  const mode = useStore((s) => s.barMode);
  const kind = useStore((s) => s.kind);
  const { left } = useChat();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  // the preference says left, the window is too narrow for it: the bar is at the bottom for now
  const fits = window.innerWidth >= SIDES.chat.min + (MIN_WORK[kind ?? 'design'] ?? 860);
  const label = t('prompt.position.button');
  return (
    <>
      <button
        className="ib sm"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={!!at}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt(at ? null : { x: r.right, y: r.bottom + 4 });
        }}
      >
        {left ? <DockLeft /> : <DockBottom />}
      </button>
      {at && (
        <Menu x={at.x} y={at.y} align="right" label={label} onClose={() => setAt(null)}>
          <MenuItem
            label={t('prompt.position.bottom')}
            hint={t('prompt.position.bottomHint')}
            icon={<DockBottom />}
            checked={mode === 'float'}
            onSelect={() => {
              setBarMode('float');
              setAt(null);
            }}
          />
          <MenuItem
            label={t('prompt.position.left')}
            hint={fits ? t('prompt.position.leftHint') : t('prompt.position.leftNarrow')}
            icon={<DockLeft />}
            checked={mode === 'left'}
            disabled={!fits && mode !== 'left'}
            onSelect={() => {
              setBarMode('left');
              setAt(null);
            }}
          />
        </Menu>
      )}
    </>
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

/** Whether the next request starts from scratch or continues the last Claude Code conversation. */
export function ContextChip({ target }: { target: 'ai' | 'claude' }) {
  const { t } = useTranslation();
  const last = useStore((s) => s.conversation);
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

/** The requests of this project, newest first, from the same record as the left column; a row opens to the steps, the answer and the files. */
export function HistoryList({ onReuse, onOpen }: { onReuse?: (prompt: string) => void; onOpen?: (file: string) => void }) {
  const { t } = useTranslation();
  const turns = useTurns();
  const list = [...turns].reverse();
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
          {list.map((r, i) => (
            <HistoryRow key={r.id} r={r} latest={i === 0} onReuse={onReuse} onOpen={onOpen} />
          ))}
        </ol>
      )}
    </section>
  );
}

function HistoryRow({ r, latest, onReuse, onOpen }: { r: Turn; latest: boolean; onReuse?: (prompt: string) => void; onOpen?: (file: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <li className={`hist ${r.state}${open ? ' open' : ''}`}>
      <span className="hist-state" title={t(`prompt.history.${r.state}`)}>
        {r.state === 'running' ? <Spinner size={14} /> : r.state === 'done' ? <Done /> : <Failed />}
      </span>
      <span className="hist-body">
        <button className="hist-prompt" title={r.prompt} aria-expanded={open} onClick={() => setOpen(!open)}>
          {r.prompt}
        </button>
        <span className="hist-meta">
          {time(r.startedAt)} · {t(`prompt.history.${r.agent}`)}
          {r.agent === 'claude' && ` · ${r.continued ? t('prompt.history.continued') : t('prompt.history.new')}`}
          {r.source !== 'editor' && ` · ${r.source === 'cli' ? t('prompt.chat.fromCli') : t('prompt.chat.fromMcp')}`}
        </span>
        {open && <TurnBody turn={r} latest={latest} onOpen={onOpen} onReuse={onReuse} />}
      </span>
      {onReuse && !open && (
        <button className="ib sm" aria-label={t('prompt.history.reuse')} title={t('prompt.history.reuse')} onClick={() => onReuse(r.prompt)}>
          <Reuse />
        </button>
      )}
    </li>
  );
}
