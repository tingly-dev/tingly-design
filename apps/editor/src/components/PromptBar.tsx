import { useEffect, useRef, useState } from 'react';
import { elementLabel, attr, slideTitle } from '@dc/core';
import { canvasOf, currentFile, display, parsed, useStore } from '../store';
import { cancelFastEdit, delegateToClaude, runFastEdit, runJQuery } from '../fastedit';
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
  const [target, setTarget] = useState<Target>('ai');
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (health && !health.fastEdit && target === 'ai') setTarget(health.claudeCli ? 'claude' : 'jquery');
    // only when health first arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health]);

  const fallback = useStore((s) => currentFile(s));
  const targetName = useStore((s) => {
    const f = sel?.kind === 'el' || sel?.kind === 'board' ? sel.file : fallback;
    if (!f) return '';
    if (s.kind === 'slides') return `整张幻灯片 ${slideTitle(display(s, f) ?? '') || f}`;
    return `整个画板 ${canvasOf(s).boards[f]?.title || f}`;
  });
  const file = sel?.kind === 'el' || sel?.kind === 'board' ? sel.file : fallback;
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

  const submit = () => {
    const t = text.trim();
    if (!t || !file || running || disabled) return;
    if (target === 'ai') void runFastEdit(file, tid, t);
    else if (target === 'claude') {
      useStore.setState({ fast: { status: 'idle', mode: 'ai', lines: [] } });
      void delegateToClaude(file, tid, t);
    } else void runJQuery(file, t);
    if (target !== 'jquery') setText('');
  };

  const showTicker = fast.status !== 'idle' || fast.note || activeDelegate || (lastDelegate && lastDelegate.state !== 'done');
  return (
    <div className="prompt" role="region" aria-label="让 AI 修改">
      <div className="head">
        <span className="target" title={label}>
          {handle ? (
            <>
              <code>{handle}</code> &lt;{tag}&gt; {label}
            </>
          ) : file ? (
            <>{targetName}</>
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
      <div className="body">
        <textarea
          ref={box}
          className={target === 'jquery' ? 'code' : ''}
          rows={target === 'jquery' ? 3 : 1}
          value={text}
          placeholder={why ?? PLACEHOLDER[target]}
          aria-label="请求"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {running ? (
          <button className="btn outline send" onClick={cancelFastEdit}>
            <Stop /> 停止
          </button>
        ) : (
          <button className="btn primary send" onClick={submit} disabled={disabled || !text.trim()}>
            <Send /> {target === 'jquery' ? '执行' : '发送'}
          </button>
        )}
      </div>
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
