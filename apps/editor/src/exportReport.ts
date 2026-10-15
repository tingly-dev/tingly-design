import type { ExportReport } from '@dc/export/timing';

/** The stage that took longest, and its share of the whole export. */
export function slowestStage(report: ExportReport): { id: string; percent: number } | null {
  const top = Object.entries(report.stages).sort((a, b) => b[1].ms - a[1].ms)[0];
  return top && report.wallMs > 0 ? { id: top[0], percent: Math.min(100, Math.round((top[1].ms / report.wallMs) * 100)) } : null;
}

/** Frames per second so far, and the seconds left at that pace. */
export function pace(done: number, total: number, startedAt: number, now = performance.now()): { fps: number; left: number } | null {
  const s = (now - startedAt) / 1000;
  if (done < 3 || s < 1) return null;
  const fps = done / s;
  return { fps: Math.round(fps * 10) / 10, left: Math.max(0, Math.round((total - done) / fps)) };
}
