import { useEffect, useRef, useState } from 'react';
import { elementLabel, attr, type Attachment } from '@dc/core';
import { display, parsed, toast, useCanvas, useStore } from '../store';
import { cancelFastEdit, delegateToClaude, runFastEdit, runJQuery } from '../fastedit';
import { keepAttachments, useAttachments } from '../attachments';
import { AttachButton, AttachTray } from './Attachments';
import { Send, Stop } from './icons';

type Target = 'ai' | 'claude' | 'jquery';

const PLACEHOLDER: Record<Target, string> = {
  ai: '描述要改什么，比如“把按钮改成圆角、颜色更深一些”',
  claude: '交给 Claude Code：适合改脚本、数据、跨画板或新建画板',
  jquery: "$('#dc12').css('color', '#15803d')",
};

/** Where requests go: the fast in-page model, Claude Code, or jQuery typed by hand. */
export function PromptBar() {
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
    if (health && !health.fastEdit && target === 'ai') setTarget(health.claudeCli ? 'claude' : 'jquery');
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
  const lastDelegate = delegates.at(-1);

  const disabled =
    !file || (target === 'ai' && health?.fastEdit === false) || (target === 'claude' && health?.claudeCli === false);
  const why =
    target === 'ai' && health?.fastEdit === false
      ? '服务端没有配置 ANTHROPIC_API_KEY，快速 AI 不可用。'
      : target === 'claude' && health?.claudeCli === false
        ? '本机找不到 claude 命令，无法委托。'
        : null;

  // jQuery is typed by hand: there is no model to show a file to
  const attaching = target !== 'jquery';
  const [keeping, setKeeping] = useState(false);
  const submit = async () => {
    const t = text.trim();
    const project = useStore.getState().project;
    if (!t || !file || !project || running || disabled || keeping) return;
    let files: Attachment[] = [];
    if (attaching && attach.items.length) {
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
    if (target === 'ai') void runFastEdit(file, tid, t, files);
    else if (target === 'claude') {
      useStore.setState({ fast: { status: 'idle', mode: 'ai', lines: [] } });
      void delegateToClaude(file, tid, t, files);
    } else void runJQuery(file, t);
    if (target !== 'jquery') {
      setText('');
      attach.clear();
    }
  };

  const showTicker = fast.status !== 'idle' || fast.note || activeDelegate || (lastDelegate && lastDelegate.state !== 'done');
  return (
    <div
      className={`prompt${attaching && attach.over ? ' dropping' : ''}`}
      role="region"
      aria-label="让 AI 修改"
      {...(attaching ? { onDragOver: attach.handlers.onDragOver, onDragLeave: attach.handlers.onDragLeave, onDrop: attach.handlers.onDrop } : {})}
    >
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
              ['jquery', 'jQuery'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} aria-pressed={target === k} onClick={() => setTarget(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {attaching && <AttachTray items={attach.items} onRemove={attach.remove} />}
      <div className="body">
        {attaching && <AttachButton onFiles={(f) => void attach.add(f)} />}
        <textarea
          ref={box}
          className={target === 'jquery' ? 'code' : ''}
          rows={target === 'jquery' ? 3 : 1}
          value={text}
          placeholder={why ?? placeholder[target]}
          aria-label="请求"
          onChange={(e) => setText(e.target.value)}
          onPaste={attaching ? attach.handlers.onPaste : undefined}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {running ? (
          <button className="btn outline send" onClick={cancelFastEdit}>
            <Stop /> 停止
          </button>
        ) : (
          <button className="btn primary send" onClick={() => void submit()} disabled={disabled || keeping || !text.trim()}>
            <Send /> {target === 'jquery' ? '执行' : '发送'}
          </button>
        )}
      </div>
      {attaching && attach.over && <div className="drop-hint">松开即可附加，作为这次请求的参考</div>}
      {showTicker && (
        <div className="ticker" aria-live="polite">
          {fast.lines.map((l, i) =>
            l.divider ? (
              <div key={i} className="note-line">
                {l.code}
              </div>
            ) : (
            <div key={i} className={`st ${l.ok ? '' : 'bad'}`}>
              <i>{l.ok ? '✓' : '✕'}</i>
              <span>
                {l.code}
                {l.error ? `\n${l.error}` : ''}
              </span>
            </div>
            ),
          )}
          {running && !fast.lines.length && <div className="note-line">{fast.mode === 'ai' ? '正在读设计并写第一行…' : '正在执行…'}</div>}
          {fast.note && <div className="note-line">{fast.note}</div>}
          {fast.status === 'done' && fast.lines.length > 0 && <div className="note-line">已保存。</div>}
          {(activeDelegate ?? (lastDelegate?.state === 'error' ? lastDelegate : null)) && (
            <>
              <div className="note-line claude">
                Claude Code {activeDelegate ? '正在处理' : '没能完成'}：{(activeDelegate ?? lastDelegate)!.prompt}
              </div>
              {(activeDelegate ?? lastDelegate)!.lines.slice(-6).map((l, i) => (
                <div key={i} className="claude-line">
                  {l}
                </div>
              ))}
              {lastDelegate?.state === 'error' && !activeDelegate && <div className="note-line">{lastDelegate.result}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
