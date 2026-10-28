import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ProjectKind } from '@dc/core';
import { KIND_PANE_IDS, type PaneId } from '../panes';
import { togglePane, useStore } from '../store';
import { useDash } from './dash/dash';
import { useComments, useCurrentTab } from './docs/docs';
import { CodeI, Database, Message, Panel } from './icons';
import { BarButton } from './TopBar';

/** How a pane is offered in the top bar: its icon, its names and the count it wears. */
interface PaneDef {
  icon: ReactNode;
  label: (t: TFunction) => string;
  hint?: (t: TFunction) => string;
  Badge?: () => ReactNode;
}

/** Things in the data that need a look: flagged rows, failed or disconnected sources. */
function SourcesBadge() {
  const report = useDash((s) => s.report);
  const states = useDash((s) => s.states);
  const problems = (report?.flagged ?? 0) + (report?.errors.length ?? 0) + Object.values(states).filter((s) => s.status === 'error' || s.status === 'connect').length;
  return problems ? <span className="badge">{problems}</span> : null;
}

/** Comment threads still open on the tab being read. */
function CommentsBadge() {
  const tab = useCurrentTab();
  const comments = useComments();
  const open = comments.threads.filter((x) => x.tab === tab && !x.resolved).length;
  return open ? <span className="badge blue">{open}</span> : null;
}

const PANE_DEF: Record<PaneId, PaneDef> = {
  inspector: { icon: <Panel />, label: (t) => t('common.pane.inspector'), hint: (t) => t('common.pane.inspectorHint') },
  sources: { icon: <Database />, label: (t) => t('dash.sources.label'), Badge: SourcesBadge },
  code: { icon: <CodeI />, label: (t) => t('dash.bar.code') },
  comments: { icon: <Message />, label: (t) => t('docs.app.comments'), Badge: CommentsBadge },
};

/**
 * The buttons that open a kind's side panes: one per pane, at the end of the bar's own actions, in the
 * same place and look in every kind that has a column (`KIND_PANE_IDS`). A kind adds a pane by
 * listing it there; the bar is not touched.
 */
export function PaneToggles({ kind }: { kind: ProjectKind }) {
  const { t } = useTranslation();
  const pane = useStore((s) => s.pane);
  return (
    <>
      {KIND_PANE_IDS[kind].map((id) => {
        const def = PANE_DEF[id];
        return <BarButton key={id} icon={def.icon} label={def.label(t)} title={def.hint?.(t)} on={pane === id} badge={def.Badge ? <def.Badge /> : null} onClick={() => togglePane(id)} data-pane={id} />;
      })}
    </>
  );
}
