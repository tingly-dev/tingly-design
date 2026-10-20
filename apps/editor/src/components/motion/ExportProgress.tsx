import { useTranslation } from 'react-i18next';
import { pace } from '../../exportReport';
import type { Exporting } from './useMotionExport';

/**
 * The top bar's export readout: a chip of one fixed size whatever the numbers say (tabular digits, a
 * reserved cell for the pace, nothing wraps), so the bar around it stays still while frames come in.
 * The longer wording of the pace and where the file is made are in the tooltip. Click to cancel.
 */
export function ExportProgress({ exporting, where, onCancel }: { exporting: Exporting; where: string; onCancel: () => void }) {
  const { t } = useTranslation();
  const percent = Math.min(100, Math.floor((exporting.done / exporting.total) * 100));
  const p = pace(exporting.done, exporting.total, exporting.startedAt);
  const tip = [where, p ? t('motion.export.pace', { fps: p.fps, left: p.left }) : '', t('motion.export.cancelHint')].filter(Boolean).join('. ');
  return (
    <button className="btn ghost mexp" onClick={onCancel} title={tip} aria-label={`${t('motion.export.progress', { percent })}. ${t('motion.export.cancel')}`} data-export-progress="">
      <i className="mexp-fill" style={{ transform: `scaleX(${percent / 100})` }} />
      <Slot text={t('motion.export.progress', { percent })} widest={t('motion.export.progress', { percent: 100 })} />
      <Slot className="mexp-pace" text={p ? t('motion.export.paceShort', { fps: Math.round(p.fps), left: p.left }) : ''} widest={t('motion.export.paceShort', { fps: 88, left: 888 })} />
      <span className="mexp-cancel">{t('motion.export.cancel')}</span>
    </button>
  );
}

/** A text that always takes the room of its widest form: the real text and an invisible widest one share a cell. */
function Slot({ text, widest, className }: { text: string; widest: string; className?: string }) {
  return (
    <span className={`mexp-slot${className ? ` ${className}` : ''}`}>
      <span>{text}</span>
      <span aria-hidden="true">{widest}</span>
    </span>
  );
}
