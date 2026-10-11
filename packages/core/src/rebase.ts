/**
 * Turn `from` into `to` inside `current`, which may have been changed elsewhere
 * since (by another editor, an agent, a terminal). The edit is located by the
 * text around it, so a change somewhere else in the file doesn't block it.
 */
export function rebaseSwap(current: string, from: string, to: string): string {
  if (current === from) return to;
  let p = 0;
  while (p < from.length && p < to.length && from[p] === to[p]) p++;
  let s = 0;
  while (s < from.length - p && s < to.length - p && from[from.length - 1 - s] === to[to.length - 1 - s]) s++;
  const mid = from.slice(p, from.length - s);
  const repl = to.slice(p, to.length - s);
  for (const ctx of [80, 40, 16]) {
    const before = from.slice(Math.max(0, p - ctx), p);
    const after = from.slice(from.length - s, from.length - s + ctx);
    const needle = before + mid + after;
    const at = current.indexOf(needle);
    if (at < 0 || current.indexOf(needle, at + 1) >= 0) continue;
    const start = at + before.length;
    return current.slice(0, start) + repl + current.slice(start + mid.length);
  }
  throw new Error('这段内容之后又被改过，没法自动撤销。');
}
