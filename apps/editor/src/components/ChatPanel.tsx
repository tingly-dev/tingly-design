import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { SIDES } from '../sideWidth';
import { useStore } from '../store';
import { InChatList, SideResizer } from './SideResizer';
import { Spinner } from './icons';
import { Transcript } from './Transcript';

/**
 * The conversation column on the left (.design/chat-panel.md): the whole app of a kind sits to its
 * right, and the request bar's input sits at its bottom. The shell wraps every kind's app in the
 * same two elements whether the column shows or not, so choosing a place or a narrow window never
 * rebuilds the work. A kind with a list of its own on the left (slides, docs, design systems)
 * hands it to `ListColumn`, which puts it in the column's first tab.
 */

/** What the work to the right of the column needs at least before it is too cramped; narrower than this plus the column's own minimum, the request bar goes back to the bottom. */
export const MIN_WORK: Record<string, number> = {
  design: 860,
  slides: 820,
  motion: 860,
  dashboard: 840,
  docs: 920,
  'design-system': 600,
};

export interface ChatSlots {
  /** the request bar sits in the column (else at the bottom of the work) */
  left: boolean;
  /** where the bar's input goes */
  composer: HTMLElement | null;
  /** where a kind's own list goes */
  list: HTMLElement | null;
  /** the name of a kind's list while it has one in the column */
  setListLabel: (label: string | null) => void;
  /** what the bar does with a file or a request taken out of the record */
  bridge: MutableRefObject<{ onOpen?: (file: string) => void; onReuse?: (prompt: string) => void }>;
}

const Slots = createContext<ChatSlots>({ left: false, composer: null, list: null, setListLabel: () => {}, bridge: { current: {} } });
export const useChat = () => useContext(Slots);

function useWindowWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

export function ChatShell({ children }: { children: ReactNode }) {
  const pref = useStore((s) => s.barMode);
  const kind = useStore((s) => s.kind);
  const loaded = useStore((s) => s.loaded);
  const project = useStore((s) => s.project);
  // presenting a deck, or looking at a canvas without editing it: the work gets the whole window
  const hidden = useStore((s) => s.present !== null || (s.kind === 'design' && s.mode !== 'edit'));
  const width = useWindowWidth();
  const need = SIDES.chat.min + (MIN_WORK[kind ?? 'design'] ?? 860);
  const left = !!project && loaded && pref === 'left' && !hidden && width >= need;

  const [composer, setComposer] = useState<HTMLElement | null>(null);
  const [list, setList] = useState<HTMLElement | null>(null);
  const [listLabel, setListLabel] = useState<string | null>(null);
  const bridge = useRef<ChatSlots['bridge']['current']>({});
  const slots = useMemo<ChatSlots>(() => ({ left, composer, list, setListLabel, bridge }), [left, composer, list]);

  return (
    <Slots.Provider value={slots}>
      <div className={`chat-shell${left ? ' left' : ''}`} style={left ? ({ '--chat-need': `${MIN_WORK[kind ?? 'design'] ?? 860}px` } as React.CSSProperties) : undefined}>
        {left && <ChatPanel listLabel={listLabel} setComposer={setComposer} setList={setList} bridge={bridge} />}
        <div className="chat-work">{children}</div>
      </div>
    </Slots.Provider>
  );
}

function ChatPanel({
  listLabel,
  setComposer,
  setList,
  bridge,
}: {
  listLabel: string | null;
  setComposer: (el: HTMLElement | null) => void;
  setList: (el: HTMLElement | null) => void;
  bridge: ChatSlots['bridge'];
}) {
  const { t } = useTranslation();
  const tab = useStore((s) => (listLabel ? s.chatTab : 'chat'));
  const note = useStore((s) => s.chatNote);
  const running = useStore((s) => s.fast.status === 'running' || s.delegates.some((d) => d.state === 'start' || d.state === 'progress'));

  // looking at the conversation reads what it had to say
  useEffect(() => {
    if (tab === 'chat' && note) useStore.setState({ chatNote: null });
  }, [tab, note]);

  const onOpen = useCallback((f: string) => bridge.current.onOpen?.(f), [bridge]);
  const onReuse = useCallback((p: string) => bridge.current.onReuse?.(p), [bridge]);

  return (
    <aside className="chat-panel" aria-label={t('prompt.chat.label')}>
      <header className="chat-head">
        {listLabel ? (
          <div className="chat-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'list'} className={tab === 'list' ? 'on' : ''} onClick={() => useStore.setState({ chatTab: 'list' })}>
              {listLabel}
            </button>
            <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => useStore.setState({ chatTab: 'chat' })}>
              {t('prompt.chat.tab')}
              {tab !== 'chat' && running && (
                <span className="chat-dot running" title={t('prompt.chat.stateRunning')}>
                  <Spinner size={11} />
                </span>
              )}
              {tab !== 'chat' && !running && note && <span className={`chat-dot ${note}`} title={note === 'failed' ? t('prompt.chat.stateFailed') : t('prompt.chat.stateDone')} />}
            </button>
          </div>
        ) : (
          <b className="chat-title">{t('prompt.chat.label')}</b>
        )}
      </header>
      <div className="chat-body">
        <div className="chat-list-slot" ref={setList} hidden={!listLabel || tab !== 'list'} />
        <Transcript hidden={!!listLabel && tab !== 'chat'} onOpen={onOpen} onReuse={onReuse} />
      </div>
      <div className="chat-composer-slot" ref={setComposer} />
      <SideResizer id="chat" edge="end" name={t('prompt.chat.resizeName')} />
    </aside>
  );
}

/**
 * A kind's own list on the left of its work: in place when the request bar is at the bottom, the
 * conversation column's first tab when the bar is on the left. `className` is the kind's own
 * class, which the list's styles hang on.
 */
export function ListColumn({ label, className, children }: { label: string; className: string; children: ReactNode }) {
  const { left, list, setListLabel } = useChat();
  useEffect(() => {
    if (!left) return;
    setListLabel(label);
    return () => setListLabel(null);
  }, [left, label, setListLabel]);
  if (!left || !list) return <>{children}</>;
  return createPortal(
    <InChatList.Provider value={true}>
      <div className={`chat-list ${className}`}>{children}</div>
    </InChatList.Provider>,
    list,
  );
}
