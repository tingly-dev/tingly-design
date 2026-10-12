import { at } from './base';

/**
 * The page embedding the editor (Tingly Box, say): what we tell it and what it
 * may ask of us. Themes have their own two messages in theme.ts. The protocol
 * is in docs/en/embedding.md; bump PROTOCOL in apps/server/src/layout.ts when
 * it changes incompatibly.
 */

export const EMBEDDED = window.parent !== window;

export type ToHost =
  | { type: 'tingly-design:ready'; version: string | null; protocol: number | null; project: string | null; search: string }
  | { type: 'tingly-design:location'; project: string | null; search: string };

export type FromHost = { type: 'tingly-design:open'; project?: string | null; search?: string };

function tell(m: ToHost): void {
  if (EMBEDDED) window.parent.postMessage(m, '*');
}

const projectOf = (search: string) => new URLSearchParams(search).get('p');

/** Loaded: the host learns our version and where we are, so it can mirror the address into its own. */
export function announceReady(health: { version?: string; protocol?: number } | null): void {
  tell({ type: 'tingly-design:ready', version: health?.version ?? null, protocol: health?.protocol ?? null, project: projectOf(location.search), search: location.search });
}

/** history.replaceState for the editor's own address (slide, tab, view), told to the host. */
export function replaceUrl(url: URL): void {
  history.replaceState(null, '', url);
  tell({ type: 'tingly-design:location', project: projectOf(url.search), search: url.search });
}

/** Go to a project, or back to the launcher. A page load, like following a link. */
export function goTo(project: string | null): void {
  location.href = project ? `${at('')}?p=${encodeURIComponent(project)}` : at('');
}

const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** The host may open a project, or the launcher, from its own navigation. */
export function listenToHost(): void {
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent && e.source !== window.opener) return;
    const d = e.data as FromHost | null;
    if (d?.type !== 'tingly-design:open') return;
    if (typeof d.search === 'string' && d.search.startsWith('?') && PROJECT_NAME.test(projectOf(d.search) ?? '')) {
      location.href = at('') + d.search;
      return;
    }
    if (d.project == null || d.project === '') goTo(null);
    else if (typeof d.project === 'string' && PROJECT_NAME.test(d.project)) goTo(d.project);
  });
}
