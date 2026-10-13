import { useStore } from '../../store';
import { runJQuery } from '../../fastedit';

/**
 * jQuery typed by hand: the same execution and write-back path the fast
 * model uses, without a model. An advanced tool, so it lives in the Code
 * tab next to the source rather than as a third choice in the prompt bar
 * (.design/agent-feedback.md §7). The draft is shared with the run feed's
 * "在 jQuery 里改", which drops the fast model's statements here.
 */
export function JQueryBox({ file, handle }: { file: string; handle?: string }) {
  const draft = useStore((s) => s.jqDraft);
  const running = useStore((s) => s.fast.status === 'running');
  const run = () => {
    if (!draft.trim() || running) return;
    void runJQuery(file, draft);
  };
  return (
    <div className="sec jqbox">
      <h3>jQuery</h3>
      <textarea
        className="code"
        rows={4}
        value={draft}
        placeholder={`${handle ? `$('${handle}')` : "$('h1')"}.css('color', '#15803d')`}
        aria-label="jQuery 语句"
        onChange={(e) => useStore.setState({ jqDraft: e.target.value })}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            run();
          }
        }}
      />
      <div className="jqrow">
        <span className="hint">
          在 <code>{file}</code> 上逐条执行，和快速 AI 走同一条回写链路；不需要 API key。{handle ? <> 选中的元素是 <code>{handle}</code>。</> : null}
        </span>
        <button className="btn primary sm" onClick={run} disabled={!draft.trim() || running} title="执行（⌘↵）">
          执行
        </button>
      </div>
    </div>
  );
}
