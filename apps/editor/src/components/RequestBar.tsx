import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Attachment } from '@dc/core';
import { toast, useStore, type LastRun } from '../store';
import { stopRun } from '../fastedit';
import { keepAttachments, useAttachments } from '../attachments';
import { AttachButton, AttachTray } from './Attachments';
import { RunFeed, useAutoGrow } from './RunFeed';
import { BarPill, BarTools, HistoryList, useBarKeys } from './AgentBar';
import { useChat } from './ChatPanel';
import { Send, Stop } from './icons';

/**
 * The request bar every kind shares: the run feed (or the request history)
 * above, a head row, attachments, the box with send or stop, and the hints
 * under it. Floating at the bottom of the work and folding to a pill, or, when
 * the person put it on the left, only the input part at the bottom of the
 * conversation column (the column itself is `ChatPanel`). What the head says and where a request goes are the kind's: the canvas,
 * deck and motion bar (`PromptBar`) picks Fast AI or Claude Code and names what
 * is pointed at; the other kinds (`AskClaude`) hand everything to Claude Code.
 */
export function RequestBar({
  variant,
  label,
  head,
  options,
  placeholder,
  disabled,
  busyRun,
  busyText,
  onSend,
  onOpen,
}: {
  /** the bar's class, which carries its look and where it sits in the kind's layout */
  variant: 'prompt' | 'dsask';
  /** the bar's name to assistive tech */
  label: string;
  /** the head row before its tools: what the request is about, where it goes */
  head: ReactNode;
  /** the row under the box: settings of this request (a conversation to continue, pictures) */
  options?: ReactNode;
  placeholder: string;
  /** sending is impossible (nothing to point at, no model, no CLI) */
  disabled?: boolean;
  /** the run this bar would otherwise start again; while there is one the button stops it */
  busyRun: LastRun;
  /** said when a request is sent while that run is going */
  busyText: string;
  /** send the request with its kept attachments; false puts the text back (it could not start) */
  onSend: (request: string, files: Attachment[]) => Promise<boolean>;
  /** show a file a run changed */
  onOpen?: (file: string) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const attach = useAttachments();
  const collapsed = useStore((s) => s.barCollapsed);
  const historyOpen = useStore((s) => s.historyOpen);
  const chat = useChat();
  const inColumn = chat.left && !!chat.composer;
  useBarKeys(box);
  useAutoGrow(box, text);

  const busy = !!busyRun;
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!blocked) return;
    const t = setTimeout(() => setBlocked(false), 4000);
    return () => clearTimeout(t);
  }, [blocked]);
  useEffect(() => {
    if (!busy) setBlocked(false);
  }, [busy]);

  const [keeping, setKeeping] = useState(false);
  const submit = async () => {
    const req = text.trim();
    const project = useStore.getState().project;
    if (!req || !project || disabled || keeping) return;
    if (busy) return setBlocked(true);
    let files: Attachment[] = [];
    if (attach.items.length) {
      setKeeping(true);
      try {
        files = await keepAttachments(project, attach.items);
      } catch (e) {
        toast(t('prompt.attach.keepFailed', { error: (e as Error).message }), 'error');
        return;
      } finally {
        setKeeping(false);
      }
    }
    // the request moves into the feed at once; it comes back if the run could not start
    setText('');
    if (chat.left) useStore.setState({ chatTab: 'chat' });
    if (await onSend(req, files)) attach.clear();
    else setText((cur) => cur || req);
  };
  const reuse = (p: string) => {
    setText(p);
    requestAnimationFrame(() => box.current?.focus());
  };
  // the column's record puts a request back in the box and shows a file through this bar
  const { bridge } = chat;
  const latest = useRef({ reuse, onOpen });
  latest.current = { reuse, onOpen };
  useEffect(() => {
    if (!chat.left) return;
    bridge.current = { onOpen: (f) => latest.current.onOpen?.(f), onReuse: (p) => latest.current.reuse(p) };
    return () => {
      bridge.current = {};
    };
  }, [chat.left, bridge]);

  if (collapsed && !inColumn)
    return (
      <div className={`${variant} collapsed`} role="region" aria-label={label}>
        <BarPill />
      </div>
    );

  const bar = (
    <div
      className={`${variant}${inColumn ? ' chat-composer' : ''}${attach.over ? ' dropping' : ''}`}
      role="region"
      aria-label={label}
      onDragOver={attach.handlers.onDragOver}
      onDragLeave={attach.handlers.onDragLeave}
      onDrop={attach.handlers.onDrop}
    >
      {!inColumn && (historyOpen ? <HistoryList onReuse={reuse} onOpen={onOpen} /> : <RunFeed onReuse={reuse} onOpen={onOpen} />)}
      <div className="head">
        {head}
        <BarTools />
      </div>
      <AttachTray items={attach.items} onRemove={attach.remove} />
      <div className="body">
        <AttachButton onFiles={(f) => void attach.add(f)} />
        <textarea
          ref={box}
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={t('prompt.bar.request')}
          onChange={(e) => setText(e.target.value)}
          onPaste={attach.handlers.onPaste}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {busy ? (
          <button className="btn outline send" onClick={() => stopRun(busyRun)}>
            <Stop /> {t('common.stop')}
          </button>
        ) : (
          <button className="btn primary send" onClick={() => void submit()} disabled={disabled || keeping || !text.trim()}>
            <Send /> {t('common.send')}
          </button>
        )}
      </div>
      {options && <div className="opts">{options}</div>}
      {attach.over && <div className="drop-hint">{t('prompt.attach.dropHint')}</div>}
      {blocked ? (
        <div className="prompt-hint warn" role="status">
          {busyText}
        </div>
      ) : (
        text.includes('\n') && <div className="prompt-hint">{t('prompt.bar.enterHint')}</div>
      )}
    </div>
  );
  return inColumn ? createPortal(bar, chat.composer!) : bar;
}
