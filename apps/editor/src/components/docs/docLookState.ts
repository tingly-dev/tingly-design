import { useMemo } from 'react';
import { DOC_INDEX, docLookOf, parseDoc, type DocLookOf, type ThemeSystem, type ThemeTarget } from '@dc/core';
import { api } from '../../api';
import { t } from '../../i18n';
import { display, recordChange, toast, useStore } from '../../store';
import { installedOf, useInstalled, type Installed } from '../ds/ds';
import { editDoc } from './docs';

/**
 * A doc wears a design system (`.design/doc-design-system.md`): the systems it has installed (`ds/<ns>/tokens.json`,
 * listed in doc.json's `designSystems`), and the one it wears (doc.json's `theme`). The files never hold colours;
 * the look is resolved from the tokens when the doc is drawn, by the editor's page and every export alike.
 */

const systemsOf = (installed: Installed[]): ThemeSystem[] => installed.map((x) => ({ namespace: x.record.namespace, title: x.record.title, tokens: x.tokens }));

/** The look the open doc has now, kept up to date as the doc, its settings or its systems change. */
export function useDocLook(): DocLookOf {
  const text = useStore((s) => display(s, DOC_INDEX));
  const installed = useInstalled();
  return useMemo(() => docLookOf(parseDoc(text), systemsOf(installed)), [text, installed]);
}

/** The same, read once (an export). */
export function currentDocLook(): DocLookOf {
  const s = useStore.getState();
  return docLookOf(parseDoc(display(s, DOC_INDEX)), systemsOf(installedOf(s)));
}

/** Where a system's font files are served from. */
export function systemFontBase(namespace: string): string {
  return `${api.rawBase(useStore.getState().project!)}ds/${namespace}/`;
}

/** Dress the doc in a theme of an installed system, or take it back to its own look (`null`): one step of undo, and Claude Code is told. */
export function applyDocTheme(to: ThemeTarget | null): void {
  const s = useStore.getState();
  const systems = systemsOf(installedOf(s));
  const sys = to ? systems.find((x) => x.namespace === to.system) : undefined;
  if (to && !sys) return;
  editDoc((d) => {
    if (to) d.theme = { system: to.system, theme: to.theme };
    else delete d.theme;
  }, to ? `theme → ${sys!.title}` : 'theme → the doc’s own look');
  recordChange({ type: 'theme', namespace: to?.system ?? '', title: sys?.title ?? null, theme: to?.theme ?? 'original', stay: 0 });
}

/** The wording of a theme: `System · Theme` when the system has several, its name when it has one. */
export function docThemeName(sys: { title: string; themes: { id: string; name: string }[] }, theme: string): string {
  const th = sys.themes.find((x) => x.id === theme);
  return sys.themes.length > 1 ? t('panel.theme.systemTheme', { system: sys.title, theme: th?.name ?? theme }) : sys.title;
}

/** After an install the copy of tokens.json reaches the editor as a server event: wait for it, then wear the system's first theme. */
export async function wearWhenInstalled(namespace: string): Promise<void> {
  const found = () => installedOf(useStore.getState()).find((x) => x.record.namespace === namespace);
  for (let i = 0; i < 40 && !found(); i++) await new Promise((r) => setTimeout(r, 100));
  const sys = found();
  if (!sys || !sys.tokens.themes.length) return toast(t('docs.theme.notReady'), 'error');
  applyDocTheme({ system: namespace, theme: sys.tokens.themes[0].id });
}

/** The look each publishing channel is made for: what its export offers to wear in one step (a new channel adds a row, and its preview calls `applyLook`). */
export const CHANNEL_LOOK = { wechat: 'wechat' } as const;

/** A built-in look in one step: install it and wear it (the WeChat preview's "Use the WeChat look" passes the channel's own). */
export async function applyLook(look: string): Promise<void> {
  const project = useStore.getState().project;
  if (!project) return;
  try {
    const r = await api.installDs(project, { look });
    const ns = (r.record as { namespace?: string }).namespace;
    if (ns) await wearWhenInstalled(ns);
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}
