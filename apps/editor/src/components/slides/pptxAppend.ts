import { adaptSize, deckSize, DECK_FILE, slideFile } from '@dc/core';
import type { PptxDiagnostic } from '@dc/core';
import { api, type PptxAppendPlan } from '../../api';
import { savedUpTo } from '../../editEngine';
import { t } from '../../i18n';
import { deckOf, editDeck, useStore } from '../../store';

/** Appending a PowerPoint to the deck that is open: the server converts (nothing written),
 * then this transaction brings the batch in — uploads first (invisible), the deck order
 * second (so every page appears in its place as its file lands), then the page files, and
 * one undo that removes exactly this batch. A failure rolls the batch back. */
export async function appendPptx(name: string, bytes: Uint8Array): Promise<string> {
  const project = useStore.getState().project;
  if (!project) throw new Error(t('slides.append.failed', { name }));
  let plan: PptxAppendPlan;
  try {
    plan = await api.pptxSlides(project, bytes, name);
  } catch (error) {
    const diagnostics = (error as { body?: { diagnostics?: PptxDiagnostic[] } }).body?.diagnostics;
    if (diagnostics) throw new Error(t('slides.append.refused', { name, count: diagnostics.length }));
    throw error;
  }
  const size = deckSize(deckOf(useStore.getState()));
  const sources: Record<string, string> = {};
  for (const slide of plan.slides) {
    // content follows the deck's page shape, the way a deck resize scales its slides
    sources[slide.id] = plan.size[0] === size[0] && plan.size[1] === size[1] ? slide.source : adaptSize(slide.source, plan.size, size, { root: false });
  }
  const ids = plan.slides.map((s) => s.id);
  // media and provenance are invisible files: they land first, and an abort leaves only orphans
  for (const [path, base64] of Object.entries(plan.files)) await api.keepUpload(project, path, base64Bytes(base64));
  const landed: string[] = [];
  try {
    editDeck((d) => {
      d.order = [...d.order.filter((id) => !ids.includes(id)), ...ids];
      if (!d.cover) d.cover = ids[0];
    }, t('slides.append.journal', { count: ids.length, name }), true, { ids, sources });
    await savedUpTo(DECK_FILE);
    for (const slide of plan.slides) {
      // undone while the batch was still landing: stop and take back what landed
      if (!deckOf(useStore.getState()).order.includes(ids[0])) {
        for (const id of landed) await removeSlide(project, id);
        return t('slides.append.undone');
      }
      await api.put(project, slideFile(slide.id), { content: sources[slide.id], baseVersion: null, actor: 'human', summary: t('slides.append.journalOne', { id: slide.id, name }) });
      landed.push(slide.id);
    }
  } catch (error) {
    // nothing half-appended stays: the pages that landed go away, then the ids leave the order
    try {
      for (const id of landed) await removeSlide(project, id);
      editDeck((d) => {
        d.order = d.order.filter((id) => !ids.includes(id));
      }, t('slides.append.undone'), false);
    } catch { /* the failure to report is the original one */ }
    throw error;
  }
  const skipped = plan.diagnostics.filter((d) => d.code === 'slide_skipped').length;
  return skipped ? t('slides.append.addedSkipped', { name, count: ids.length, skipped }) : t('slides.append.added', { name, count: ids.length });
}

/** Delete one of the batch's slide files, as `deleteFile` does for a single file. */
async function removeSlide(project: string, id: string): Promise<void> {
  const file = slideFile(id);
  await savedUpTo(file);
  const version = useStore.getState().files[file]?.server?.version;
  if (version) await api.remove(project, file, version);
  useStore.setState((s) => {
    const files = { ...s.files };
    delete files[file];
    return { files };
  });
}

function base64Bytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
