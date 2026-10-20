import { SideResizer } from '../SideResizer';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DASH_INDEX, datasetIdOf } from '@dc/core';
import { display, edit, toast, useStore } from '../../store';

/**
 * The dashboard's files as text. The original lets only Claude write the
 * page; here a person can edit it too (it is a file in a repository).
 */
export function CodePanel() {
  const { t } = useTranslation();
  const names = useStore((s) =>
    Object.keys(s.files)
      .filter((p) => p.startsWith('files/') || p === DASH_INDEX || datasetIdOf(p))
      .sort((a, b) => (a.startsWith('files/') === b.startsWith('files/') ? a.localeCompare(b) : a.startsWith('files/') ? -1 : 1))
      .join('\n'),
  );
  const list = useMemo(() => names.split('\n').filter(Boolean), [names]);
  const [path, setPath] = useState('files/index.html');
  const text = useStore((s) => display(s, path)) ?? '';
  const [draft, setDraft] = useState(text);
  const dirty = draft !== text;
  useEffect(() => {
    if (!dirty) setDraft(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  useEffect(() => {
    setDraft(useStore.getState().files[path] ? (display(useStore.getState(), path) ?? '') : '');
  }, [path]);
  const save = () => {
    if (!dirty) return;
    if (path.endsWith('.json')) {
      try {
        JSON.parse(draft);
      } catch (e) {
        return toast(t('dash.code.badJson', { path, message: (e as Error).message }), 'error');
      }
    }
    edit(path, () => draft, { actor: 'human', summary: `${path} edited` });
  };
  return (
    <aside className="dashside code" aria-label={t('dash.code.label')}>
      <SideResizer id="dashside" edge="start" name={t('dash.code.label')} />
      <div className="row">
        <select className="input" value={path} aria-label={t('dash.code.file')} onChange={(e) => setPath(e.target.value)}>
          {list.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button className="btn primary" disabled={!dirty} onClick={save}>
          {t('common.save')}
        </button>
      </div>
      {dirty && <p className="hint">{t('dash.code.unsaved')}</p>}
      <textarea
        className="code dashcode"
        spellCheck={false}
        value={draft}
        aria-label={t('dash.code.edit', { path })}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            save();
          }
        }}
      />
    </aside>
  );
}
