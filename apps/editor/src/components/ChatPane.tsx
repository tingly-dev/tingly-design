import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowWidth } from '../hooks';
import { chatFits, chatLeftWidth, MIN_WORK } from '../panes';
import { togglePane, useStore } from '../store';
import { Close } from './icons';
import { SideResizer } from './SideResizer';
import { Transcript } from './Transcript';

/**
 * The conversation as a right-hand pane (.design/chat-panel.md): one of a kind's panes, beside
 * Properties, Comments or Sources, with an ordinary request bar at its foot. The left edge is always
 * the kind's own list. The provider holds the slot the bar's input portals into — no DOM and no
 * containing block — so opening or closing the pane never rebuilds the work; the kinds paint
 * `<ChatPane>` where their right column goes.
 */

export interface ChatSlots {
  /** where the request bar's input goes while the conversation pane is open */
  composer: HTMLElement | null;
  setComposer: (el: HTMLElement | null) => void;
  /** what the bar does with a file or a request taken out of the record */
  bridge: MutableRefObject<{ onOpen?: (file: string) => void; onReuse?: (prompt: string) => void }>;
}

const Slots = createContext<ChatSlots>({ composer: null, setComposer: () => {}, bridge: { current: {} } });
export const useChat = () => useContext(Slots);

/** A window too narrow for the open pane closes it; nothing moves by itself, and nothing reopens on widening. */
function CloseWhenTooNarrow() {
  const kind = useStore((s) => s.kind);
  const pane = useStore((s) => s.pane);
  const width = useWindowWidth();
  useEffect(() => {
    if (kind && pane === 'chat' && !chatFits(kind, width)) useStore.setState({ pane: null });
  }, [kind, pane, width]);
  return null;
}

/** The one provider around every kind's app: the pane's slot for the request bar and the record's bridge. */
export function ChatSlotsProvider({ children }: { children: ReactNode }) {
  const [composer, setComposer] = useState<HTMLElement | null>(null);
  const bridge = useRef<ChatSlots['bridge']['current']>({});
  const slots = useMemo<ChatSlots>(() => ({ composer, setComposer, bridge }), [composer]);
  return (
    <Slots.Provider value={slots}>
      <CloseWhenTooNarrow />
      {children}
    </Slots.Provider>
  );
}

/** The conversation column: its head, the record of every turn and the request bar at its foot. */
export function ChatPane() {
  const { t } = useTranslation();
  const kind = useStore((s) => s.kind);
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
      style={kind ? ({ '--chat-left': `${chatLeftWidth(kind)}px`, '--chat-need': `${MIN_WORK[kind]}px` } as CSSProperties) : undefined}
    >
      <SideResizer id="chat" edge="start" name={t('prompt.chat.resizeName')} />
      <header className="chat-head">
        <b className="chat-title">{t('prompt.chat.label')}</b>
        <button className="ib x" aria-label={t('prompt.chat.close')} title={t('prompt.chat.close')} onClick={() => togglePane('chat')}>
          <Close />
        </button>
      </header>
      <div className="chat-body">
        <Transcript onOpen={onOpen} onReuse={onReuse} />
      </div>
      <div className="chat-composer-slot" ref={setComposer} />
    </aside>
  );
}