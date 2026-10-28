import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  CANVAS_FILE,
  DECK_FILE,
  applyThemePlan,
  parseCanvas,
  parseDeck,
  stringifyCanvas,
  stringifyDeck,
  changeScope,
  planOriginal,
  planTheme,
  slideFile,
  themeRecordOf,
  type ThemePlan,
  type ThemeRecord,
  type ThemeSystem,
  type ThemeTarget,
} from '@dc/core';
import { t } from '../../i18n';
import { canvasOf, display, dropGroup, edit, forgetChange, isLastGroup, recordChange, slideIds, toast, undo, useStore } from '../../store';
import { installedOf, type Installed } from '../ds/ds';

/**
 * Switching a canvas or deck to a theme of an installed design system (`.design/project-theme.md`): which files,
 * the plan core makes from their sources, and writing it as ordinary edits plus the `theme` record in the index.
 * A deck can apply to every slide or only the open one; a canvas is always every artboard.
 */
export type ThemeScope = 'all' | 'one';

type S = ReturnType<typeof useStore.getState>;

const indexFile = (s: S) => (s.kind === 'slides' ? DECK_FILE : CANVAS_FILE);

/** The files a switch rewrites: every artboard, every slide, or the open slide. */
export function themeFiles(s: S, scope: ThemeScope): string[] {
  if (s.kind === 'slides') return scope === 'one' ? (s.slide ? [slideFile(s.slide)] : []) : slideIds(s).map(slideFile);
  const c = canvasOf(s);
  return c.order.filter((f) => c.boards[f]);
}

export function themeSystems(installed: Installed[]): ThemeSystem[] {
  return installed.map((x) => ({ namespace: x.record.namespace, title: x.record.title, tokens: x.tokens }));
}

export function themeRecord(s: S): ThemeRecord | null {
  try {
    return themeRecordOf(JSON.parse(display(s, indexFile(s)) ?? '{}'));
  } catch {
    return null;
  }
}

/** What the Theme tab reads: the installed systems, the record, and the sources it would change. */
export function useThemeInputs(scope: ThemeScope) {
  const installed = useStore((s) => installedOf(s));
  const systems = useMemo(() => themeSystems(installed), [installed]);
  const recordText = useStore((s) => JSON.stringify(themeRecord(s)));
  const record = useMemo(() => (JSON.parse(recordText) as ThemeRecord | null) ?? null, [recordText]);
  const sources = useStore(useShallow((s) => themeFiles(s, scope).map((f) => display(s, f) ?? '')));
  const kind = useStore((s) => s.kind);
  return { kind, systems, record, sources };
}

export const themeName = (sys: ThemeSystem, theme: string): string => {
  const th = sys.tokens.themes.find((x) => x.id === theme);
  return sys.tokens.themes.length > 1 ? t('panel.theme.systemTheme', { system: sys.title, theme: th?.name ?? theme }) : sys.title;
};

export function planFor(kind: string | null, systems: ThemeSystem[], sources: string[], record: ThemeRecord | null, to: ThemeTarget | 'original'): ThemePlan | null {
  const opts = { fonts: kind === 'slides' };
  return to === 'original' ? planOriginal(sources, systems, record, opts) : planTheme(sources, systems, to, record, opts);
}

/** Write the theme over the files and the index; the toast brings the old ones back. */
export function applyTheme(to: ThemeTarget | 'original', scope: ThemeScope): void {
  const s = useStore.getState();
  if (s.kind !== 'design' && s.kind !== 'slides') return;
  const files = themeFiles(s, scope);
  const systems = themeSystems(installedOf(s));
  // a single slide reads the project's record (what it came from) but leaves it alone
  const whole = s.kind === 'design' || scope === 'all';
  const record = themeRecord(s);
  const plan = planFor(s.kind, systems, files.map((f) => display(s, f) ?? ''), record, to);
  const sys = to === 'original' ? undefined : systems.find((x) => x.namespace === to.system);
  const name = sys && to !== 'original' ? themeName(sys, to.theme) : '';
  if (!plan || !plan.changes) {
    // a work already in the theme says so; one that has nothing of the system's to follow says that
    const already = to !== 'original' && plan?.from?.system === to.system && plan.from.theme === to.theme;
    return void toast(t(to === 'original' || already ? 'panel.theme.nothingOriginal' : 'panel.theme.nothing', { name }));
  }

  const summary = to === 'original' ? 'theme → original look' : `theme → ${name}`;
  // every file of one switch, and the index, are one step of undo
  const group = `theme-${Date.now()}`;
  const before: Record<string, string> = {};
  const after: Record<string, string> = {};
  files.forEach((f, i) => {
    const src = display(s, f) ?? '';
    const next = applyThemePlan(src, plan.files[i]);
    if (next === src) return;
    before[f] = src;
    after[f] = next;
    edit(f, (cur) => applyThemePlan(cur, plan.files[i]), { actor: 'human', summary, group });
  });
  const setRecord = (r: ThemeRecord | null, grouped: boolean) => {
    if (!whole) return;
    const index = s.kind === 'slides' ? DECK_FILE : CANVAS_FILE;
    const set = (c: Record<string, unknown>) => (r ? (c.theme = r) : delete c.theme);
    edit(
      index,
      (src) => {
        if (s.kind === 'slides') {
          const d = structuredClone(parseDeck(src));
          set(d);
          return stringifyDeck(d);
        }
        const c = structuredClone(parseCanvas(src));
        set(c);
        return stringifyCanvas(c);
      },
      { actor: 'human', summary, ...(grouped ? { group } : { undoable: false }) },
    );
  };
  setRecord(plan.record, true);

  const file = whole ? undefined : files[0];
  recordChange({ type: 'theme', namespace: sys?.namespace ?? '', title: sys?.title ?? null, theme: sys && to !== 'original' ? to.theme : 'original', stay: plan.stay, file });
  toast(t(to === 'original' ? 'panel.theme.appliedOriginal' : 'panel.theme.applied', { name, count: plan.changes }), 'info', {
    label: t('common.undo'),
    run: () => {
      const now = useStore.getState();
      if (now.project !== s.project) return;
      forgetChange(changeScope({ type: 'theme', namespace: '', title: null, theme: '', stay: 0, file }));
      // nothing was done since: the same step ⌘Z takes
      if (isLastGroup(group)) return undo();
      // something was: put the files back by what they were, the ones still as this switch left them
      let skipped = false;
      for (const f of Object.keys(before)) {
        if (display(now, f) !== after[f]) skipped = true;
        else edit(f, (cur) => (cur === after[f] ? before[f] : cur), { actor: 'human', summary: `undo ${summary}`, undoable: false });
      }
      setRecord(record, false);
      dropGroup(group);
      if (skipped) toast(t('panel.theme.restoreFailed'), 'error');
    },
  });
}
