import { Segmented } from './Segmented';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { elementLabel, attr, type Attachment } from '@dc/core';
import { display, parsed, useCanvas, useStore } from '../store';
import type { LastRun } from '../store/agent';
import { delegateToClaude, runFastEdit } from '../fastedit';
import { ContextChip } from './AgentBar';
import { ImageToggle } from './ImageToggle';
import { RequestBar } from './RequestBar';
import { offerPrompt } from '../headless';

type Target = 'ai' | 'claude';

/** Where requests go: the fast in-page model or Claude Code. jQuery typed by hand lives in the Code tab (panel/JQueryBox.tsx). */
export function PromptBar() {
  const { t } = useTranslation();
  const sel = useStore((s) => s.selection);
  const fast = useStore((s) => s.fast);
  const health = useStore((s) => s.health);
  const delegates = useStore((s) => s.delegates);
  const canvas = useCanvas();
  const [target, setTarget] = useState<Target>('ai');

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
  // the command line's prompt --fast types into this bar (headless.ts)
  useEffect(() => offerPrompt(() => file), [file]);
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
  const disabled =
    !file || (target === 'ai' && health?.fastEdit === false) || (target === 'claude' && health?.claudeCli === false);
  const why =
    target === 'ai' && health?.fastEdit === false
      ? t('prompt.bar.noFastModel')
      : target === 'claude' && health?.claudeCli === false
        ? t('prompt.bar.noClaudeCli')
        : null;

  const send = async (req: string, files: Attachment[]): Promise<boolean> => {
    if (!file) return false;
    if (target === 'claude') return delegateToClaude(file, tid, req, files);
    void runFastEdit(file, tid, req, files);
    return true;
  };

  return (
    <RequestBar
      variant="prompt"
      label={t('prompt.bar.label')}
      head={
        <>
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
        </>
      }
      options={
        <>
          <ContextChip target={target} />
          {target === 'claude' && <ImageToggle />}
        </>
      }
      picker={
        <>
          <Segmented
            label={t('prompt.bar.who')}
            value={target}
            onChange={setTarget}
            options={[
              { value: 'ai', label: t('prompt.bar.fastAi') },
              { value: 'claude', label: 'Claude Code' },
            ]}
          />
          {why && (
            <button className="tb setup" onClick={() => useStore.setState({ aiSettingsOpen: true })}>
              {t('prompt.bar.setUp')}
            </button>
          )}
        </>
      }
      placeholder={why ?? placeholder[target]}
      disabled={disabled}
      busyRun={busyRun}
      busyText={target === 'claude' ? t('prompt.bar.busyClaude') : t('prompt.bar.busyFast')}
      onSend={send}
    />
  );
}
