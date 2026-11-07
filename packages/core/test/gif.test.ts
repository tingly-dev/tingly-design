import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { composeGif, GifError, gifFrameAt, isGif, parseGif } from '../src/gif';

// 16×16 solid red, green, blue held 100 / 200 / 300 ms; blink.gif loops forever, blink-once.gif has no loop block
// patches.gif: red 16×16; then a blue 8×8 at (4,4) cleared after it; then a green 8×8 at (0,0)
const file = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/gif/${name}`, import.meta.url)));
const px = (rgba: Uint8ClampedArray, x: number, y: number, w = 16) => Array.from(rgba.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

describe('parseGif', () => {
  it('reads the size, loop count and delays', () => {
    const g = parseGif(file('blink.gif'));
    expect([g.width, g.height, g.frames.length, g.loops]).toEqual([16, 16, 3, 0]);
    expect(g.frames.map((f) => f.delay)).toEqual([100, 200, 300]);
    expect(parseGif(file('blink-once.gif')).loops).toBe(-1);
  });

  it('composes the frames the way a browser draws them', () => {
    const colours: number[][] = [];
    for (const f of composeGif(parseGif(file('blink.gif')))) colours.push(px(f.rgba, 3, 3));
    expect(colours).toEqual([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]]);
  });

  it('keeps a patch on the picture and clears it when asked to', () => {
    const seen: number[][][] = [];
    for (const f of composeGif(parseGif(file('patches.gif')))) seen.push([px(f.rgba, 10, 10), px(f.rgba, 1, 1), px(f.rgba, 14, 14)]);
    // frame 1: the blue patch sits on the red
    expect(seen[1][0]).toEqual([0, 0, 255, 255]);
    // frame 2: the patch was cleared (the rectangle is transparent now), the green one is on top at the corner
    expect(seen[2][0]).toEqual([0, 0, 0, 0]);
    expect(seen[2][1]).toEqual([0, 255, 0, 255]);
    expect(seen[2][2]).toEqual([255, 0, 0, 255]);
  });

  it('refuses what is not a GIF, is cut short, or is too large', () => {
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as GifError).code;
      }
    };
    expect(code(() => parseGif(new Uint8Array([1, 2, 3])))).toBe('not-gif');
    expect(code(() => parseGif(file('blink.gif').slice(0, 40)))).toBe('truncated');
    expect(code(() => parseGif(file('blink.gif'), { maxPixels: 100, maxTotalPixels: 1e9, maxFrames: 9 }))).toBe('too-large');
    expect(code(() => parseGif(file('blink.gif'), { maxPixels: 1e9, maxTotalPixels: 1e9, maxFrames: 2 }))).toBe('too-large');
    expect(isGif(file('blink.gif'))).toBe(true);
  });
});

describe('gifFrameAt', () => {
  const d = [100, 200, 300];
  it('follows the delays and loops forever when the file says so', () => {
    expect([0, 99, 100, 299, 300, 599, 600, 700, 1250].map((ms) => gifFrameAt(d, 0, ms))).toEqual([0, 0, 1, 1, 2, 2, 0, 1, 0]);
  });
  it('plays once and holds the last image when there is no loop block', () => {
    expect([599, 600, 5000].map((ms) => gifFrameAt(d, -1, ms))).toEqual([2, 2, 2]);
  });
  it('counts repeats after the first play', () => {
    expect(gifFrameAt(d, 1, 650)).toBe(0);
    expect(gifFrameAt(d, 1, 1199)).toBe(2);
    expect(gifFrameAt(d, 1, 1200)).toBe(2);
  });
  it('shows the first image before it starts, and lets the author override the file', () => {
    expect(gifFrameAt(d, 0, -50)).toBe(0);
    expect(gifFrameAt(d, -1, 650, 'loop')).toBe(0);
    expect(gifFrameAt(d, 0, 650, 'once')).toBe(2);
    expect(gifFrameAt([100], 0, 500)).toBe(0);
  });
});
