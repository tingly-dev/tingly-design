import { ACTOR_LABEL } from '@dc/core';
import { focusBoard, useCanvas, useStore } from '../store';

function time(iso: string): string {
  const d = new Date(iso);
  const same = new Date().toDateString() === d.toDateString();
  return same
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Boards() {
  const canvas = useCanvas();
  const sel = useStore((s) => s.selection);
  const errors = useStore((s) => s.runtimeErrors);
  if (!canvas.order.length) return <div className="empty">还没有画板。点上方的“画板”新建一个。</div>;
  return (
    <div className="list">
      {canvas.order.map((f) => {
        const b = canvas.boards[f];
        const current = (sel?.kind === 'board' || sel?.kind === 'el') && sel.file === f;
        return (
          <button
            key={f}
            className="row"
            aria-current={current}
            onClick={() => {
              useStore.setState({ selection: { kind: 'board', file: f } });
              focusBoard(f);
            }}
          >
            <span className="name">{b.title || f}</span>
            {errors[f] ? <span className="badge err">出错</span> : <span className="meta">{`${b.w}×${b.h}`}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Journal() {
  const journal = useStore((s) => s.journal);
  if (!journal.length) return <div className="empty">这里会按时间记下每一次改动：谁改的、改了哪个画板、改了什么。</div>;
  return (
    <div className="journal" aria-live="polite">
      {[...journal].reverse().map((j) => (
        <div className="jline" key={j.id}>
          <div className="bar" style={{ background: `var(--actor-${j.actor})` }} />
          <div>
            <div className="who">
              <b style={{ color: `var(--actor-${j.actor})` }}>{ACTOR_LABEL[j.actor] ?? j.actor}</b>
              <span>{j.file}</span>
              <span style={{ marginLeft: 'auto' }}>{time(j.at)}</span>
            </div>
            <div className="what">{j.summary}</div>
            {j.prompt && <div className="asked">“{j.prompt.length > 120 ? j.prompt.slice(0, 119) + '…' : j.prompt}”</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const count = useStore((s) => s.journal.length);
  return (
    <>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'boards'} onClick={() => useStore.setState({ leftTab: 'boards' })}>
          画板
        </button>
        <button role="tab" aria-selected={tab === 'journal'} onClick={() => useStore.setState({ leftTab: 'journal' })}>
          改动记录{count ? ` ${count}` : ''}
        </button>
      </div>
      {tab === 'boards' ? <Boards /> : <Journal />}
    </>
  );
}
