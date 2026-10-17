import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { deckOf, useSlideIds, useStore } from '../../store';
import { goToSlide } from './slides';
import { RightPanel } from '../panel/RightPanel';
import { PromptBar } from '../PromptBar';
import { ContextMenu, JournalPopover } from '../Overlays';
import { Present, stopPresent } from './Present';
import { SlidesTopBar, TopLeft } from './SlidesBars';
import { Stage } from './Stage';
import { Strip } from './Strip';

export function SlidesApp() {
  const loaded = useStore((s) => s.loaded);
  const panelOpen = useStore((s) => s.panelOpen);
  const present = useStore((s) => !!s.present);
  const slide = useStore((s) => s.slide);
  const ids = useSlideIds();
  const { t } = useTranslation();

  // keep the stage on a slide that exists (another editor may delete it)
  useEffect(() => {
    if (!loaded) return;
    if (!slide || !ids.includes(slide)) goToSlide(ids[0] ?? null);
  }, [loaded, slide, ids]);

  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement && useStore.getState().present) stopPresent();
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    const title = deckOf(useStore.getState()).title;
    if (title) document.title = t('slides.docTitle', { title });
  });

  return (
    <>
    {!present && <SlidesTopBar />}
    <div className="app slides" data-mode={present ? 'play' : 'edit'}>
      <Strip />
      <main className="stage">
        <TopLeft />
        <Stage />
        {loaded && !present && <PromptBar />}
        <JournalPopover />
      </main>
      {panelOpen && !present && <RightPanel />}
      <ContextMenu />
      {present && <Present />}
    </div>
    </>
  );
}
