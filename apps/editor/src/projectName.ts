import { FOLDER_NAME_RE, slugOf } from '@dc/core';

// the same rules `tingly-design new -i` asks by
export const NAME_RE = FOLDER_NAME_RE;
export { slugOf };

/** `base`, or `base-2`, `base-3`… whichever is free. */
export function freeName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const n = `${base.slice(0, 60)}-${i}`;
    if (!taken.has(n)) return n;
  }
}
