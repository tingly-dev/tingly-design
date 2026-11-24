import { useEffect, useRef, useState, type ReactNode } from 'react';
import { locator } from '../locate';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Attachment } from '@dc/core';
import { toast, useStore } from '../store';
import type { LastRun } from '../store/agent';
import { stopRun } from '../fastedit';
import { keepAttachments, useAttachments } from '../attachments';
import { AttachButton, AttachTray } from './Attachments';
import { FollowUp } from './FollowUp';
import { RunFeed, useAutoGrow } from './RunFeed';
import { BarPill, BarTools, HistoryList, useBarKeys } from './AgentBar';
import { useChat } from './ChatPane';
import { BandResizer } from './BandResizer';
import { Send, Stop } from './icons';

/**
 * The request bar every kind shares: the run feed (or the request history)
 * above, a head row (what the request is about and the bar's tools), attachments, the
 * box, a toolbar (paperclip, this request's settings, who answers, send or
 * stop) and the hints under it. Floating at the bottom of the work and folding to a pill, or, while
 * the conversation pane is open, only the input part at the pane's foot (the pane itself is
 * `ChatPane`). What the head says and where a request goes are the kind's: the canvas,
 * deck and motion bar (`PromptBar`) picks Fast AI or Claude Code and names what
 * is pointed at; the other kinds (`AskClaude`) hand everything to Claude Code.
 */
export function RequestBar({
  variant,
  label,
  head,
  options,
  picker,
  placeholder,
  disabled,
  busyRun,
  busyText,
  onSend,
}: {
  /** the bar's class, which carries its look and where it sits in the kind's layout */
  variant: 'prompt' | 'dsask';
  /** the bar's name to assistive tech */
  label: string;
  /** the head row before its tools: what the request is about, where it goes */
  head: ReactNode;
  /** the toolbar's left, after the paperclip: settings of this request (a conversation to continue, ImageGen) */
  options?: ReactNode;
  /** the toolbar's right, before send: who answers (Fast AI or Claude Code) */
  picker?: ReactNode;
  placeholder: string;
  /** sending is impossible (nothing to point at, no model, no CLI) */
  disabled?: boolean;
  /** the run this bar would otherwise start again; while there is one the button stops it */
  busyRun: LastRun;
  /** said when a request is sent while that run is going */
  busyText: string;
  /** send the request with its kept attachments; false puts the text back (it could not start) */
  onSend: (request: string, files: Attachment[]) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  // the box's text lives in the store: opening or closing the conversation pane moves the bar to another
  // container without rebuilding what was typed (the same draft follows it back to the bottom)
  const text = useStore((s) => s.draft);
  const setText = (v: string | ((cur: string) => string)) => useStore.setState((s) => ({ draft: typeof v === 'function' ? v(s.draft) : v }));
  const box = useRef<HTMLTextAreaElement>(null);
  const attach = useAttachments();
  const collapsed = useStore((s) => s.barCollapsed);
  const historyOpen = useStore((s) => s.historyOpen);
  const chat = useChat();
  const inPane = !!chat.composer;
  useBarKeys(box);
  // a height the person gave the box holds the text in a fixed box; giving it back measures the text again
  const [regrow, setRegrow] = useState(0);
  useAutoGrow(box, text, regrow);

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
    if (await onSend(req, files)) attach.clear();
    else setText((cur) => cur || req);
  };
  const reuse = (p: string) => {
    setText(p);
    requestAnimationFrame(() => box.current?.focus());
  };
  // the record puts a request back in the box and shows a file through this bar
  const { bridge } = chat;
  const kind = useStore((s) => s.kind);
  const onOpen = locator(kind);
  const latest = useRef({ reuse, onOpen });
  latest.current = { reuse, onOpen };
  useEffect(() => {
    bridge.current = { onOpen: (f) => latest.current.onOpen?.(f), onReuse: (p) => latest.current.reuse(p) };
    return () => {
      bridge.current = {};
    };
  }, [bridge]);

  if (collapsed && !inPane)
    return (
      <div className={`${variant} collapsed`} role="region" aria-label={label}>
        <BarPill />
      </div>
    );

  const bar = (
    <div
      className={`${variant}${inPane ? ' chat-composer' : ''}${attach.over ? ' dropping' : ''}`}
      role="region"
      aria-label={label}
      onDragOver={attach.handlers.onDragOver}
      onDragLeave={attach.handlers.onDragLeave}
      onDrop={attach.handlers.onDrop}
    >
      {!inPane && (historyOpen ? <HistoryList onReuse={reuse} onOpen={onOpen} /> : <RunFeed onReuse={reuse} onOpen={onOpen} />)}
      <FollowUp onEdit={reuse} />
      <div className="head">
        {head}
        <BarTools />
      </div>
      <AttachTray items={attach.items} onRemove={attach.remove} />
      <div className="body">
        <BandResizer id="request" name={t('prompt.bar.request')} edge="top" onReset={() => setRegrow((n) => n + 1)} measure={() => box.current?.offsetHeight ?? 44} />
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
      </div>
      <div className="tools">
        <AttachButton onFiles={(f) => void attach.add(f)} />
        {options && <div className="opts">{options}</div>}
        {picker}
        {busy ? (
          <button className="send stop" aria-label={t('common.stop')} title={t('common.stop')} onClick={() => stopRun(busyRun)}>
            <Stop />
          </button>
        ) : (
          <button
            className={`send${text.trim() && !disabled && !keeping ? ' ready' : ''}`}
            aria-label={t('common.send')}
            title={t('common.send')}
            onClick={() => void submit()}
            disabled={disabled || keeping || !text.trim()}
          >
            <Send />
          </button>
        )}
      </div>
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
  return inPane ? createPortal(bar, chat.composer!) : bar;
}
