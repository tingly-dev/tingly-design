import { useTranslation } from 'react-i18next';
import { followUpFor } from '@dc/core';
import { delegateToClaude } from '../fastedit';
import { dismissFollowUp, useStore } from '../store';

/**
 * The offer under the request bar after a setting changed by hand and the shape or style it left may need Claude Code
 * (.design/config-awareness.md): send the prepared request, put it in the box to change first, or let it go. Never a run on its own.
 */
export function FollowUp({ onEdit }: { onEdit: (prompt: string) => void }) {
  const { t } = useTranslation();
  const change = useStore((s) => s.followUp);
  const offer = change ? followUpFor(change) : null;
  if (!change || !offer) return null;
  const file = change.type === 'size' ? change.file : undefined;
  return (
    <div className="follow-up" role="status">
      <span className="why">{t(`prompt.followUp.${offer.reason.id}`)}</span>
      <button
        className="btn sm"
        onClick={() => {
          dismissFollowUp();
          // a request that could not start is not lost: it goes into the box to send again
          void delegateToClaude(file, null, offer.prompt).then((started) => !started && onEdit(offer.prompt));
        }}
      >
        {t(`prompt.followUp.ask.${offer.reason.id}`)}
      </button>
      <button
        className="btn sm ghost"
        onClick={() => {
          dismissFollowUp();
          onEdit(offer.prompt);
        }}
      >
        {t('prompt.followUp.edit')}
      </button>
      <button className="btn sm ghost" aria-label={t('prompt.followUp.dismiss')} title={t('prompt.followUp.dismiss')} onClick={dismissFollowUp}>
        ×
      </button>
    </div>
  );
}
