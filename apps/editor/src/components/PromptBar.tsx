import { useEffect, useRef, useState } from 'react';
import { elementLabel, attr, type Attachment } from '@dc/core';
import { display, focusBoard, parsed, toast, useCanvas, useStore, type LastRun } from '../store';
import { delegateToClaude, runFastEdit, stopRun } from '../fastedit';
import { keepAttachments, useAttachments } from '../attachments';
import { AttachButton, AttachTray } from './Attachments';
import { RunFeed, useAutoGrow } from './RunFeed';
import { Send, Stop } from './icons';
import { slideIdOf } from '@dc/core';

type Target = 'ai' | 'claude';

const PLACEHOLDER: Record<Target, string> = {
  ai: '描述要改什么，比如“把按钮改成圆角、颜色更深一些”',
  claude: '交给 Claude Code：适合改脚本、数据、跨画板或新建画板',
};

/** Where requests go: the fast in-page model or Claude Code. jQuery typed by hand lives in the Code tab (panel/JQueryBox.tsx). */
/** `onOpen` shows a file a Claude Code run changed, for kinds whose own view knows how (motion seeks to the scene). */
export function PromptBar({ onOpen }: { onOpen?: (file: string) => void } = {}) {
  const sel = useStore((s) => s.selection);
  const fast = useStore((s) => s.fast);
  const health = useStore((s) => s.health);
  const delegates = useStore((s) => s.delegates);
  const canvas = useCanvas();
  const [target, setTarget] = useState<Target>('ai');
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const attach = useAttachments();

  useEffect(() => {
    if (health && !health.fastEdit && health.claudeCli && target === 'ai') setTarget('claude');
    // only when health first arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health]);

  const slides = useStore((s) => s.kind === 'slides');
  const motion = useStore((s) => s.kind === 'motion');
  const placeholder = slides
    ? { ...PLACEHOLDER, ai: '描述要改什么，比如“标题再大一点、换成深色背景”', claude: '交给 Claude Code：适合整页重写、跨页修改、新建一组幻灯片' }
    : motion
      ? { ...PLACEHOLDER, ai: '描述要改什么，比如“标题晚半秒进来”“竖版里字再大一点”', claude: '交给 Claude Code：改一个场景、加一段动画、调整节奏、做一张封面…' }
      : PLACEHOLDER;
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
      ? '服务端没有配置 ANTHROPIC_API_KEY，快速 AI 不可用。'
      : target === 'claude' && health?.claudeCli === false
        ? '本机找不到 claude 命令，无法委托。'
        : null;

  const [keeping, setKeeping] = useState(false);
  const submit = async () => {
    const t = text.trim();
    const project = useStore.getState().project;
    if (!t || !file || !project || disabled || keeping) return;
    if (busy) return setBlocked(true);
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
    if (target === 'claude') {
      // the request moves into the feed at once; it comes back if Claude Code could not start
      setText('');
      if (await delegateToClaude(file, tid, t, files)) attach.clear();
      else setText((cur) => cur || t);
      return;
    }
    void runFastEdit(file, tid, t, files);
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

  return (
    <div
      className={`prompt${attach.over ? ' dropping' : ''}`}
      role="region"
      aria-label="让 AI 修改"
      onDragOver={attach.handlers.onDragOver}
      onDragLeave={attach.handlers.onDragLeave}
      onDrop={attach.handlers.onDrop}
    >
      <RunFeed onReuse={reuse} onOpen={open} />
      <div className="head">
        <span className="target" title={label}>
          {handle ? (
            <>
              <code>{handle}</code> &lt;{tag}&gt; {label}
            </>
          ) : file ? (
            slides ? (
              <>整页 {file.replace(/^slides\/|\.html$/g, '')}</>
            ) : motion ? (
              <>整个场景 {file.replace(/^scenes\/|\.html$/g, '')}</>
            ) : (
              <>整个画板 {canvas.boards[file]?.title || file}</>
            )
          ) : slides ? (
            '没有幻灯片'
          ) : motion ? (
            '没有场景'
          ) : (
            '没有画板'
          )}
        </span>
        <div className="seg" role="group" aria-label="交给谁">
          {(
            [
              ['ai', '快速 AI'],
              ['claude', 'Claude Code'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} aria-pressed={target === k} onClick={() => setTarget(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <AttachTray items={attach.items} onRemove={attach.remove} />
      <div className="body">
        <AttachButton onFiles={(f) => void attach.add(f)} />
        <textarea
          ref={box}
          rows={1}
          value={text}
          placeholder={why ?? placeholder[target]}
          aria-label="请求"
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
            <Stop /> 停止
          </button>
        ) : (
          <button className="btn primary send" onClick={() => void submit()} disabled={disabled || keeping || !text.trim()}>
            <Send /> 发送
          </button>
        )}
      </div>
      {attach.over && <div className="drop-hint">松开即可附加，作为这次请求的参考</div>}
      {blocked ? (
        <div className="prompt-hint warn" role="status">
          {target === 'claude' ? 'Claude Code' : '快速 AI'} 还在处理上一条。等它完成或先停止；你写的这条会留在这里。
        </div>
      ) : (
        text.includes('\n') && <div className="prompt-hint">Enter 发送，Shift + Enter 换行</div>
      )}
    </div>
  );
}
