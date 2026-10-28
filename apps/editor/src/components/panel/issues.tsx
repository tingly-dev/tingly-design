import type { SlideIssue } from '@dc/core';
import { useStore } from '../../store';

/** A check report: each issue clickable to its element, or one quiet line when nothing is wrong. */
export function IssueList({ issues, file, empty }: { issues: SlideIssue[]; file: string; empty: string }) {
  if (!issues.length) return <p className="hint" style={{ margin: 0 }}>{empty}</p>;
  return (
    <ul className="issue-list">
      {issues.map((i, n) => (
        <li key={n} className={i.level} onClick={() => i.tid !== null && useStore.setState({ selection: { kind: 'el', file, tid: i.tid } })}>
          {i.message}
        </li>
      ))}
    </ul>
  );
}
