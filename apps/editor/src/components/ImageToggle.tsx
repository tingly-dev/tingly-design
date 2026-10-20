import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ImageState } from '../api';
import { useStore } from '../store';
import { Picture } from './icons';

/**
 * Whether Claude Code may make pictures in this project, where the request is written (.design/image-generation.md).
 * Shown only once an image model is configured; a dashboard and a design system keep their own pictures and have no switch.
 */
export function ImageToggle() {
  const { t } = useTranslation();
  const kind = useStore((st) => st.kind);
  const settingsOpen = useStore((st) => st.aiSettingsOpen);
  const project = new URLSearchParams(location.search).get('p');
  const [state, setState] = useState<ImageState | null>(null);
  const skip = !project || kind === 'dashboard' || kind === 'design-system';
  // read again when the settings dialog closes: it may have configured or paused image generation
  useEffect(() => {
    if (skip || settingsOpen) return;
    api.imageState(project).then(setState, () => setState(null));
  }, [project, skip, settingsOpen]);
  if (skip || !state?.configured) return null;
  const hint = !state.global ? t('prompt.image.globalOff') : state.project ? t('prompt.image.on') : t('prompt.image.off');
  return (
    <button
      className={`ctx-chip action imgtoggle${state.on ? ' on' : ''}`}
      aria-pressed={state.on}
      disabled={!state.global}
      title={hint}
      onClick={() => api.setImageState(project, !state.project).then(setState, () => {})}
    >
      <Picture size={12} /> {t('prompt.image.label')}
    </button>
  );
}
