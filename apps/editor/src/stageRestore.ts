import { api, type StageFile, type StagePlan } from './api';
import { deleteFile, edit, newUndoGroup } from './editEngine';
import { t } from './i18n';
import { toast, useStore } from './store';
import { putFiles } from './undoRemove';

/**
 * Jumping back to a stage (.design/project-stages.md): the server writes the stage's files over the
 * project as one new change; the toast's Undo takes the text files back as one batch — rewritten
 * files wholesale, removed ones written back, ones the jump created deleted. Binary assets are not
 * covered.
 */
export async function restoreStage(project: string, id: string): Promise<StagePlan> {
  const plan = await api.restoreStage(project, id, false);
  if (plan.files.length === 0 && plan.binary === 0) return toast(t('canvas.journal.stageNothing'), 'info'), plan;
  toast(t('canvas.journal.stageDone', { stage: id }), 'info', {
    label: t('common.undo'),
    run: () => {
      // another project was opened since: the jump is not undone into that one
      if (useStore.getState().project !== project) return;
      undoStageRestore(plan.files).catch(() => toast(t('common.item.restoreFailed', { name: id }), 'error'));
    },
  });
  return plan;
}

async function undoStageRestore(files: StageFile[]): Promise<void> {
  const group = newUndoGroup();
  for (const f of files) {
    if (f.before === null) await deleteFile(f.path).catch(() => {});
    else if (f.after === null) await putFiles({ [f.path]: f.before });
    else edit(f.path, () => f.before as string, { actor: 'undo', summary: t('canvas.journal.stageUndo'), undoable: false, group });
  }
}
