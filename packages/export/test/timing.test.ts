import { describe, expect, it } from 'vitest';
import { Clock } from '../src/timing';

describe('Clock', () => {
  it('adds up each stage and counts how often it ran', async () => {
    const c = new Clock();
    c.add('seek', 10);
    c.add('seek', 5.4);
    await c.time('encode', () => new Promise((ok) => setTimeout(ok, 20)));
    const r = c.report({ route: 'browser', frames: 2, width: 1280, height: 720 });
    expect(r.stages.seek).toEqual({ ms: 15, count: 2 });
    expect(r.stages.encode.count).toBe(1);
    expect(r.stages.encode.ms).toBeGreaterThanOrEqual(15);
    expect(r.frames).toBe(2);
    expect(r.fps).toBeGreaterThan(0);
  });

  it('counts a stage that threw, and lets the error through', async () => {
    const c = new Clock();
    await expect(c.time('draw', () => Promise.reject(new Error('no')))).rejects.toThrow('no');
    expect(c.report({ route: 'server', frames: 0, width: 1, height: 1 }).stages.draw.count).toBe(1);
  });
});
