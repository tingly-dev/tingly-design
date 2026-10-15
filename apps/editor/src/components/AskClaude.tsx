import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Attachment } from '@dc/core';
import { delegateToClaude, stopRun } from '../fastedit';
import { keepAttachments, useAttachments } from '../attachments';
import { toast, useStore } from '../store';
import { AttachButton, AttachTray } from './Attachments';
import { RunFeed, useAutoGrow } from './RunFeed';
import { BarPill, BarTools, ContextChip, DockHost, DockTab, HistoryList, useDock, useDockKeys } from './AgentBar';
import { Send, Stop } from './icons';

/**
 * The request bar of the kinds that hand work to Claude Code only (design
 * systems, dashboards, docs): attachments, the request, and the
 * same run feed as the canvas and deck prompt bar.
 */
export function AskClaude({
  placeholder,
  file,
  context,
  onOpen,
}: {
  placeholder?: string;
  file?: string;
  /** what the person is looking at, told to Claude Code before the request */
  context?: () => string;
  /** show a file the run changed */
  onOpen?: (file: string) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const delegates = useStore((s) => s.delegates);
  const health = useStore((s) => s.health);
  const attach = useAttachments();
  const collapsed = useStore((s) => s.barCollapsed);
  const historyOpen = useStore((s) => s.historyOpen);
  const box = useRef<HTMLTextAreaElement>(null);
  const { docked, mode } = useDock();
  useDockKeys(box);
  useAutoGrow(box, text);
  const active = [...delegates].reverse().find((d) => d.state === 'start' || d.state === 'progress');
  const [keeping, setKeeping] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!blocked) return;
    const t = setTimeout(() => setBlocked(false), 4000);
    return () => clearTimeout(t);
  }, [blocked]);
  useEffect(() => {
    if (!active) setBlocked(false);
  }, [active]);
  const send = async () => {
    const req = text.trim();
    const project = useStore.getState().project;
    if (!req || !project || keeping) return;
    if (active) return setBlocked(true);
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
    // the request moves into the feed at once; it comes back if Claude Code could not start
    setText('');
    if (await delegateToClaude(file, null, req, files, { context: context?.() || undefined })) attach.clear();
    else setText((cur) => cur || req);
  };
  const reuse = (p: string) => {
    setText(p);
    requestAnimationFrame(() => box.current?.focus());
  };
  if (collapsed && !docked)
    return (
      <div className="dsask collapsed" role="region" aria-label={t('prompt.askClaude.label')}>
        <BarPill />
      </div>
    );
  return (
    <DockHost docked={docked}>
      <div
        className={`dsask${docked ? ` agent-dock ${mode}` : ''}${attach.over ? ' dropping' : ''}`}
        role="region"
        aria-label={t('prompt.askClaude.label')}
        onDragOver={attach.handlers.onDragOver}
        onDragLeave={attach.handlers.onDragLeave}
        onDrop={attach.handlers.onDrop}
      >
        {docked && mode === 'auto' && <DockTab />}
        {historyOpen ? <HistoryList onReuse={reuse} /> : <RunFeed onReuse={reuse} onOpen={onOpen} />}
        <div className="head">
          <ContextChip target="claude" />
          <BarTools />
        </div>
        <AttachTray items={attach.items} onRemove={attach.remove} />
        <div className="body">
          <AttachButton onFiles={(f) => void attach.add(f)} />
          <textarea
            ref={box}
            rows={1}
            value={text}
            placeholder={health?.claudeCli === false ? t('prompt.bar.noClaudeCli') : (placeholder ?? t('prompt.askClaude.placeholder'))}
            aria-label={t('prompt.bar.request')}
            onChange={(e) => setText(e.target.value)}
            onPaste={attach.handlers.onPaste}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape' && docked && mode === 'auto') e.currentTarget.blur();
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {active ? (
            <button className="btn outline" onClick={() => stopRun({ kind: 'delegate', id: active.id })}>
              <Stop /> {t('common.stop')}
            </button>
          ) : (
            <button className="btn primary" onClick={() => void send()} disabled={!text.trim() || keeping || health?.claudeCli === false}>
              <Send /> {t('common.send')}
            </button>
          )}
        </div>
        {attach.over && <div className="drop-hint">{t('prompt.attach.dropHint')}</div>}
        {blocked ? (
          <div className="prompt-hint warn" role="status">
            {t('prompt.bar.busyClaude')}
          </div>
        ) : (
          text.includes('\n') && <div className="prompt-hint">{t('prompt.bar.enterHint')}</div>
        )}
      </div>
    </DockHost>
  );
}
