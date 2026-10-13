import { useEffect, useRef, useState } from 'react';
import type { Attachment } from '@dc/core';
import { delegateToClaude, stopRun } from '../fastedit';
import { keepAttachments, useAttachments } from '../attachments';
import { toast, useStore } from '../store';
import { AttachButton, AttachTray } from './Attachments';
import { RunFeed, useAutoGrow } from './RunFeed';
import { Send, Stop } from './icons';

/**
 * The request bar of the kinds that hand work to Claude Code only (design
 * systems, dashboards, docs, motion): attachments, the request, and the
 * same run feed as the canvas and deck prompt bar.
 */
export function AskClaude({
  placeholder = '交给 Claude Code：从代码库补全 token 和组件、写品牌手册、做封面…',
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
  const [text, setText] = useState('');
  const delegates = useStore((s) => s.delegates);
  const health = useStore((s) => s.health);
  const attach = useAttachments();
  const box = useRef<HTMLTextAreaElement>(null);
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
    const t = text.trim();
    const project = useStore.getState().project;
    if (!t || !project || keeping) return;
    if (active) return setBlocked(true);
    let files: Attachment[] = [];
    if (attach.items.length) {
      setKeeping(true);
      try {
        files = await keepAttachments(project, attach.items);
      } catch (e) {
        toast(`附件没能存进项目：${(e as Error).message}`, 'error');
        return;
      } finally {
        setKeeping(false);
      }
    }
    // the request moves into the feed at once; it comes back if Claude Code could not start
    setText('');
    if (await delegateToClaude(file, null, t, files, { context: context?.() || undefined })) attach.clear();
    else setText((cur) => cur || t);
  };
  const reuse = (p: string) => {
    setText(p);
    requestAnimationFrame(() => box.current?.focus());
  };
  return (
    <div
      className={`dsask${attach.over ? ' dropping' : ''}`}
      role="region"
      aria-label="交给 Claude Code"
      onDragOver={attach.handlers.onDragOver}
      onDragLeave={attach.handlers.onDragLeave}
      onDrop={attach.handlers.onDrop}
    >
      <RunFeed onReuse={reuse} onOpen={onOpen} />
      <AttachTray items={attach.items} onRemove={attach.remove} />
      <AttachButton onFiles={(f) => void attach.add(f)} />
      <textarea
        ref={box}
        rows={1}
        value={text}
        placeholder={health?.claudeCli === false ? '本机找不到 claude 命令，无法委托。' : placeholder}
        aria-label="请求"
        onChange={(e) => setText(e.target.value)}
        onPaste={attach.handlers.onPaste}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
      />
      {active ? (
        <button className="btn outline" onClick={() => stopRun({ kind: 'delegate', id: active.id })}>
          <Stop /> 停止
        </button>
      ) : (
        <button className="btn primary" onClick={() => void send()} disabled={!text.trim() || keeping || health?.claudeCli === false}>
          <Send /> 发送
        </button>
      )}
      {attach.over && <div className="drop-hint">松开即可附加，作为这次请求的参考</div>}
      {blocked ? (
        <div className="prompt-hint warn" role="status">
          Claude Code 还在处理上一条。等它完成或先停止；你写的这条会留在这里。
        </div>
      ) : (
        text.includes('\n') && <div className="prompt-hint">Enter 发送，Shift + Enter 换行</div>
      )}
    </div>
  );
}
