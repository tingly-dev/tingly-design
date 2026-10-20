import { useTranslation } from 'react-i18next';
import { sceneFile, type MotionJson } from '@dc/core';
import { motionOf, setPieceNote } from './motion';
import { notesOf, setNotesIn } from '../slides/slides';
import { NoteBox } from '../NoteBox';
import { display, useStore } from '../../store';
import type { MotionInfo } from './MotionFrame';

/** The piece's note, and the note of the scene on the stage. */
export function MotionNotes({ motion, scenes, sceneId }: { motion: MotionJson; scenes: Record<string, string>; sceneId: string | undefined }) {
  const { t } = useTranslation();
  return (
    <div className="mnotes">
      <label>
        <span>{t('motion.notes.piece')}</span>
        <NoteBox
          className="snotes"
          saved={motion.note ?? ''}
          current={() => motionOf().note ?? ''}
          onSave={setPieceNote}
          placeholder={t('motion.notes.piecePlaceholder')}
          label={t('motion.notes.pieceLabel')}
        />
      </label>
      {sceneId && scenes[sceneId] !== undefined && (
        <label>
          <span>{t('motion.notes.scene', { id: sceneId })}</span>
          <NoteBox
            key={sceneId}
            className="snotes"
            saved={notesOf(scenes[sceneId])}
            current={() => notesOf(display(useStore.getState(), sceneFile(sceneId)))}
            onSave={(v) => setNotesIn(sceneFile(sceneId), v)}
            placeholder={t('motion.notes.scenePlaceholder')}
            label={t('motion.notes.sceneLabel', { id: sceneId })}
          />
        </label>
      )}
    </div>
  );
}

/** What the player found wrong with the piece, scene by scene. */
export function MotionIssues({ info }: { info: MotionInfo | null }) {
  const { t } = useTranslation();
  return (
    <div className="missues">
      {info?.issues.length ? (
        <ul>
          {info.issues.map((i, n) => (
            <li key={n} className={i.level}>
              <b>{i.scene}</b> {i.message}
            </li>
          ))}
        </ul>
      ) : (
        <p>{t('motion.stage.noIssues')}</p>
      )}
    </div>
  );
}
