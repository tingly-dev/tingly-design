/**
 * Where an export spends its time. A route keeps one `Clock`, wraps each stage
 * of a frame in `time()`, and hands `report()` to whoever shows the result.
 * Plain data, so it crosses a postMessage and a JSON line unchanged.
 */
export interface StageTime {
  /** Total milliseconds in this stage over the whole export. */
  ms: number;
  /** Times the stage ran (a stage can skip frames). */
  count: number;
}

export interface ExportReport {
  /** Which route made the file, and why that one. */
  route: 'browser' | 'server';
  /** Milliseconds from start to a finished file. */
  wallMs: number;
  frames: number;
  /** Frames per second actually achieved (frames / wall time). */
  fps: number;
  width: number;
  height: number;
  /** Per stage, in the order they run in a frame. Stage names are fixed ids; the editor words them. */
  stages: Record<string, StageTime>;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Clock {
  private t0 = now();
  private stages: Record<string, StageTime> = {};

  add(stage: string, ms: number) {
    const s = (this.stages[stage] ??= { ms: 0, count: 0 });
    s.ms += ms;
    s.count++;
  }

  /** Run `fn`, counting its time (also when it rejects) under `stage`. */
  async time<T>(stage: string, fn: () => Promise<T> | T): Promise<T> {
    const t = now();
    try {
      return await fn();
    } finally {
      this.add(stage, now() - t);
    }
  }

  report(o: { route: ExportReport['route']; frames: number; width: number; height: number }): ExportReport {
    const wallMs = now() - this.t0;
    const stages = Object.fromEntries(Object.entries(this.stages).map(([k, v]) => [k, { ms: Math.round(v.ms), count: v.count }]));
    return { ...o, wallMs: Math.round(wallMs), fps: wallMs > 0 ? Math.round((o.frames / wallMs) * 10000) / 10 : 0, stages };
  }
}
