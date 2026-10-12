/**
 * Where the server is, as the browser reaches it.
 *
 * The built editor's assets load from <base>assets/, so the server root is one
 * folder up from this module: / when it runs on its own, /design/ when a host
 * mounts it there (docs/en/embedding.md). Under Vite's dev server it is /.
 */
export const BASE: string = import.meta.env.DEV ? '/' : new URL('../', import.meta.url).pathname;

/** The server's origin and base without the trailing slash: what sandbox documents and CSPs take as "origin". */
export const SERVER: string = location.origin + BASE.replace(/\/$/, '');

/** A server path, such as `api/projects`, under the base. */
export const at = (path: string): string => BASE + path.replace(/^\/+/, '');
