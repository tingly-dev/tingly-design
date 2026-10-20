/**
 * Relative paths in a project's files (uploads/…, assets/…, an imported
 * page's files) point at the project's raw files under `base`. The slide
 * runtime and the motion player resolve them the same way.
 */
export function resolveSrc(src: unknown, base: string): unknown {
  if (typeof src !== 'string' || !base) return src;
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)) return src;
  // a base can carry a query (?v=3) that busts the browser's copy of a picture that changed; it goes after the path
  const [dir, query] = base.split('?');
  return dir + src.replace(/^\.?\//, '') + (query && !src.includes('?') ? '?' + query : '');
}

/** The relative url()s in a CSS text, resolved against `base`. */
export function urlsAgainst(css: string, base: string): string {
  if (!css.includes('url(')) return css;
  return css.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/g, (m, q: string, u: string) => {
    const r = u ? resolveSrc(u, base) : u;
    return r === u ? m : `url(${q}${r}${q})`;
  });
}
