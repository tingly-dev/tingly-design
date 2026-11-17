import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { chatRestWidth, MIN_WORK } from '../panes';
import { toggleChat, useStore } from '../store';
import { Close } from './icons';
import { SideResizer } from './SideResizer';
import { Transcript } from './Transcript';

/**
 * The conversation as the leftmost column (.design/chat-panel.md): the kind's own list moves to its
 * right, the work follows, and the kind's right pane (Properties, Comments, Sources) stays where it
 * is — the conversation and the right pane can be open together. The provider holds the slot the
 * bar's input portals into — no DOM and no containing block — so opening or closing the column never
 * rebuilds the work.
 */

export interface ChatSlots {
  /** where the request bar's input goes while the conversation column is open */
  composer: HTMLElement | null;
  setComposer: (el: HTMLElement | null) => void;
  /** what the bar does with a file or a request taken out of the record */
  bridge: MutableRefObject<{ onOpen?: (file: string) => void; onReuse?: (prompt: string) => void }>;
}

const Slots = createContext<ChatSlots>({ composer: null, setComposer: () => {}, bridge: { current: {} } });
export const useChat = () => useContext(Slots);

/** The one provider around every kind's app: the column's slot for the request bar and the record's bridge. */
export function ChatSlotsProvider({ children }: { children: ReactNode }) {
  const [composer, setComposer] = useState<HTMLElement | null>(null);
  const bridge = useRef<ChatSlots['bridge']['current']>({});
  const slots = useMemo<ChatSlots>(() => ({ composer, setComposer, bridge }), [composer]);
  return <Slots.Provider value={slots}>{children}</Slots.Provider>;
}

/** The conversation column: its head, the record of every turn and the request bar at its foot. */
export function ChatPane() {
  const { t } = useTranslation();
  const kind = useStore((s) => s.kind);
  const pane = useStore((s) => s.pane);
  const { setComposer, bridge } = useChat();
  const note = useStore((s) => s.chatNote);

  // looking at the conversation reads what it had to say
  useEffect(() => {
    if (note) useStore.setState({ chatNote: null });
  }, [note]);

  const onOpen = useCallback((f: string) => bridge.current.onOpen?.(f), [bridge]);
  const onReuse = useCallback((p: string) => bridge.current.onReuse?.(p), [bridge]);

  return (
    <aside
      className="chat-pane"
      aria-label={t('prompt.chat.label')}
      style={kind ? ({ '--chat-rest': `${chatRestWidth(kind, pane)}px`, '--chat-min': `${MIN_WORK[kind]}px` } as CSSProperties) : undefined}
    >
      <header className="chat-head">
        <b className="chat-title">{t('prompt.chat.label')}</b>
        <button className="ib x" aria-label={t('prompt.chat.close')} title={t('prompt.chat.close')} onClick={toggleChat}>
          <Close />
        </button>
      </header>
      <div className="chat-body">
        <Transcript onOpen={onOpen} onReuse={onReuse} />
      </div>
      <div className="chat-composer-slot" ref={setComposer} />
      <SideResizer id="chat" edge="end" name={t('prompt.chat.resizeName')} />
    </aside>
  );
}