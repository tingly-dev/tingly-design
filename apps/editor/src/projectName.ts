export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** A folder name from a title, when the title is plain enough to give one. */
export function slugOf(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|-+$/g, '')
    .slice(0, 64);
}

/** `base`, or `base-2`, `base-3`… whichever is free. */
export function freeName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const n = `${base.slice(0, 60)}-${i}`;
    if (!taken.has(n)) return n;
  }
}
