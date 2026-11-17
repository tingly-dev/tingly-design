import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ProjectKind } from '@dc/core';
import { useWindowWidth } from '../hooks';
import { chatFits, KIND_PANE_IDS, type PaneId } from '../panes';
import { toggleChat, togglePane, useStore } from '../store';
import { useDash } from './dash/dash';
import { useComments, useCurrentTab } from './docs/docs';
import { CodeI, Conversation, Database, FilesI, Message, Panel, ReviewI, Spinner } from './icons';
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

/** Remarks written and not sent yet, so a person who left the review still sees there are some. */
function ReviewBadge() {
  const count = useStore((s) => s.remarks.length);
  return count ? <span className="badge blue">{count}</span> : null;
}

/** What the conversation is doing while its pane is closed: working, a new result or a failure. Opening the pane reads it. */
function ChatBadge() {
  const { t } = useTranslation();
  const running = useStore((s) => s.fast.status === 'running' || s.delegates.some((d) => d.state === 'start' || d.state === 'progress'));
  const note = useStore((s) => s.chatNote);
  if (!running && !note) return null;
  const label = running ? t('prompt.chat.stateRunning') : note === 'failed' ? t('prompt.chat.stateFailed') : t('prompt.chat.stateDone');
  return (
    <span className={`badge${!running && note === 'failed' ? ' err' : ' ai'}`} title={label} aria-hidden="true">
      {running ? <Spinner size={11} /> : note === 'failed' ? '!' : '•'}
    </span>
  );
}

const PANE_DEF: Record<PaneId, PaneDef> = {
  inspector: { icon: <Panel />, label: (t) => t('common.pane.inspector'), hint: (t) => t('common.pane.inspectorHint') },
  files: { icon: <FilesI />, label: (t) => t('common.pane.files'), hint: (t) => t('common.pane.filesHint') },
  review: { icon: <ReviewI />, label: (t) => t('review.pane.label'), hint: (t) => t('review.pane.hint'), Badge: ReviewBadge },
  sources: { icon: <Database />, label: (t) => t('dash.sources.label'), Badge: SourcesBadge },
  code: { icon: <CodeI />, label: (t) => t('dash.bar.code') },
  comments: { icon: <Message />, label: (t) => t('docs.app.comments'), Badge: CommentsBadge },
};

/** The conversation column: every kind has it, on the left, and it is independent of the right pane. */
const CHAT_DEF: PaneDef = { icon: <Conversation />, label: (t) => t('common.pane.chat'), hint: (t) => t('common.pane.chatHint'), Badge: ChatBadge };

/**
 * The buttons that open a kind's side panes: the conversation first (every kind has it, on the left),
 * then one per pane in the right column, in the same place and look in every kind that has one
 * (`KIND_PANE_IDS`). A kind adds a right pane by listing it there; the bar is not touched.
 */
export function PaneToggles({ kind }: { kind: ProjectKind }) {
  const { t } = useTranslation();
  const pane = useStore((s) => s.pane);
  const chatOpen = useStore((s) => s.chatOpen);
  const width = useWindowWidth();
  // the conversation needs room beside the kind's list and right pane; too narrow says why instead of moving it
  const fits = chatFits(kind, pane, width);
  return (
    <>
      <BarButton
        icon={CHAT_DEF.icon}
        label={CHAT_DEF.label(t)}
        title={fits ? CHAT_DEF.hint?.(t) : t('common.pane.chatNarrow')}
        on={chatOpen}
        disabled={!fits && !chatOpen}
        badge={CHAT_DEF.Badge ? <CHAT_DEF.Badge /> : null}
        onClick={toggleChat}
        data-pane="chat"
      />
      {KIND_PANE_IDS[kind].map((id) => {
        const def = PANE_DEF[id];
        return (
          <BarButton
            key={id}
            icon={def.icon}
            label={def.label(t)}
            title={def.hint?.(t)}
            on={pane === id}
            badge={def.Badge ? <def.Badge /> : null}
            onClick={() => togglePane(id)}
            data-pane={id}
          />
        );
      })}
    </>
  );
}
