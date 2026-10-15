import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { elementLabel, attr, type Attachment } from '@dc/core';
import { display, focusBoard, parsed, toast, useCanvas, useStore, type LastRun } from '../store';
import { delegateToClaude, runFastEdit, stopRun } from '../fastedit';
import { keepAttachments, useAttachments } from '../attachments';
import { AttachButton, AttachTray } from './Attachments';
import { RunFeed, useAutoGrow } from './RunFeed';
import { BarPill, BarTools, ContextChip, DockHost, DockTab, HistoryList, useDock, useDockKeys } from './AgentBar';
import { Send, Stop } from './icons';
import { slideIdOf } from '@dc/core';

type Target = 'ai' | 'claude';

/** Where requests go: the fast in-page model or Claude Code. jQuery typed by hand lives in the Code tab (panel/JQueryBox.tsx). */
/** `onOpen` shows a file a Claude Code run changed, for kinds whose own view knows how (motion seeks to the scene). */
export function PromptBar({ onOpen }: { onOpen?: (file: string) => void } = {}) {
  const { t } = useTranslation();
  const sel = useStore((s) => s.selection);
  const fast = useStore((s) => s.fast);
  const health = useStore((s) => s.health);
  const delegates = useStore((s) => s.delegates);
  const canvas = useCanvas();
  const [target, setTarget] = useState<Target>('ai');
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const attach = useAttachments();
  const collapsed = useStore((s) => s.barCollapsed);
  const historyOpen = useStore((s) => s.historyOpen);
  const { docked, mode } = useDock();
  useDockKeys(box);

  useEffect(() => {
    if (health && !health.fastEdit && health.claudeCli && target === 'ai') setTarget('claude');
    // only when health first arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health]);

  const slides = useStore((s) => s.kind === 'slides');
  const motion = useStore((s) => s.kind === 'motion');
  const placeholder: Record<Target, string> = slides
    ? { ai: t('prompt.placeholder.slides.ai'), claude: t('prompt.placeholder.slides.claude') }
    : motion
      ? { ai: t('prompt.placeholder.motion.ai'), claude: t('prompt.placeholder.motion.claude') }
      : { ai: t('prompt.placeholder.canvas.ai'), claude: t('prompt.placeholder.canvas.claude') };
  const stageSlide = useStore((s) => s.slide);
  const stageScene = useStore((s) => s.motionView?.scene ?? null);
  const file =
    sel?.kind === 'el' || sel?.kind === 'board'
      ? sel.file
      : slides
        ? stageSlide
          ? `slides/${stageSlide}.html`
          : undefined
        : motion
          ? stageScene
            ? `scenes/${stageScene}.html`
            : undefined
          : canvas.order[0];
  const tid = sel?.kind === 'el' ? sel.tid : null;
  const pointed = useStore((s) => {
    if (!file || tid === null) return null;
    const src = display(s, file);
    const el = src ? parsed(src).elements[tid] : undefined;
    if (!el) return null;
    const id = attr(el, 'id');
    return `${id ? '#' + id : '#dc' + tid}|${el.tag}|${elementLabel(el)}`;
  });
  const [handle, tag, label] = pointed?.split('|') ?? [];
  const running = fast.status === 'running';
  const activeDelegate = [...delegates].reverse().find((d) => d.state === 'start' || d.state === 'progress');
  // the button stops what this bar would otherwise start again: one run per agent at a time
  const busyRun: LastRun =
    (target === 'claude' || (target === 'ai' && fast.status === 'delegated')) && activeDelegate
      ? { kind: 'delegate', id: activeDelegate.id }
      : target !== 'claude' && running
        ? { kind: 'fast' }
        : null;
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
  useAutoGrow(box, text);

  const disabled =
    !file || (target === 'ai' && health?.fastEdit === false) || (target === 'claude' && health?.claudeCli === false);
  const why =
    target === 'ai' && health?.fastEdit === false
      ? t('prompt.bar.noFastModel')
      : target === 'claude' && health?.claudeCli === false
        ? t('prompt.bar.noClaudeCli')
        : null;

  const [keeping, setKeeping] = useState(false);
  const submit = async () => {
    const req = text.trim();
    const project = useStore.getState().project;
    if (!req || !file || !project || disabled || keeping) return;
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
    if (target === 'claude') {
      // the request moves into the feed at once; it comes back if Claude Code could not start
      setText('');
      if (await delegateToClaude(file, tid, req, files)) attach.clear();
      else setText((cur) => cur || req);
      return;
    }
    void runFastEdit(file, tid, req, files);
    setText('');
    attach.clear();
  };
  const reuse = (p: string) => {
    setText(p);
    requestAnimationFrame(() => box.current?.focus());
  };
  const open = (f: string) => {
    if (onOpen) return onOpen(f);
    const slide = slideIdOf(f);
    if (slides && slide) useStore.setState({ slide });
    else if (canvas.boards[f]) focusBoard(f);
  };

  if (collapsed && !docked)
    return (
      <div className="prompt collapsed" role="region" aria-label={t('prompt.bar.label')}>
        <BarPill />
      </div>
    );

  return (
    <DockHost docked={docked}>
    <div
      className={`prompt${docked ? ` agent-dock ${mode}` : ''}${attach.over ? ' dropping' : ''}`}
      role="region"
      aria-label={t('prompt.bar.label')}
      onDragOver={attach.handlers.onDragOver}
      onDragLeave={attach.handlers.onDragLeave}
      onDrop={attach.handlers.onDrop}
    >
      {docked && mode === 'auto' && <DockTab />}
      {historyOpen ? <HistoryList onReuse={reuse} /> : <RunFeed onReuse={reuse} onOpen={open} />}
      <div className="head">
        <span className="target" title={label}>
          {handle ? (
            <>
              <code>{handle}</code> &lt;{tag}&gt; {label}
            </>
          ) : file ? (
            slides ? (
              <>{t('prompt.target.slide', { name: file.replace(/^slides\/|\.html$/g, '') })}</>
            ) : motion ? (
              <>{t('prompt.target.scene', { name: file.replace(/^scenes\/|\.html$/g, '') })}</>
            ) : (
              <>{t('prompt.target.board', { name: canvas.boards[file]?.title || file })}</>
            )
          ) : slides ? (
            t('prompt.target.noSlides')
          ) : motion ? (
            t('prompt.target.noScenes')
          ) : (
            t('prompt.target.noBoards')
          )}
        </span>
        <ContextChip target={target} />
        <div className="seg" role="group" aria-label={t('prompt.bar.who')}>
          {(
            [
              ['ai', t('prompt.bar.fastAi')],
              ['claude', 'Claude Code'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} aria-pressed={target === k} onClick={() => setTarget(k)}>
              {l}
            </button>
          ))}
        </div>
        {why && (
          <button className="tb setup" onClick={() => useStore.setState({ aiSettingsOpen: true })}>
            {t('prompt.bar.setUp')}
          </button>
        )}
        <BarTools />
      </div>
      <AttachTray items={attach.items} onRemove={attach.remove} />
      <div className="body">
        <AttachButton onFiles={(f) => void attach.add(f)} />
        <textarea
          ref={box}
          rows={1}
          value={text}
          placeholder={why ?? placeholder[target]}
          aria-label={t('prompt.bar.request')}
          onChange={(e) => setText(e.target.value)}
          onPaste={attach.handlers.onPaste}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape' && docked && mode === 'auto') e.currentTarget.blur();
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
      {attach.over && <div className="drop-hint">{t('prompt.attach.dropHint')}</div>}
      {blocked ? (
        <div className="prompt-hint warn" role="status">
          {target === 'claude' ? t('prompt.bar.busyClaude') : t('prompt.bar.busyFast')}
        </div>
      ) : (
        text.includes('\n') && <div className="prompt-hint">{t('prompt.bar.enterHint')}</div>
      )}
    </div>
    </DockHost>
  );
}
