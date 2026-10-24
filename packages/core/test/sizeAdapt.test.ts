import { describe, expect, it } from 'vitest';
import { adaptSize, adaptStyle, needsRelayout } from '../src';

describe('adaptSize', () => {
  it('scales each axis and keeps type at the smaller factor', () => {
    expect(adaptStyle('width:400px;height:200px;font-size:20px;padding:10px 20px', 0.5, 0.25)).toBe('width:200px;height:50px;font-size:5px;padding:2.5px 10px');
  });
  it('keeps a small box square', () => {
    expect(adaptStyle('width:24px;height:24px;border-radius:6px', 0.5, 1)).toBe('width:12px;height:12px;border-radius:3px');
  });
  it('leaves holes, calc and percentages alone', () => {
    const s = 'width:{{w}}px;height:calc(100% - 40px);left:50%;top:10px';
    expect(adaptStyle(s, 2, 2)).toBe('width:{{w}}px;height:calc(100% - 40px);left:50%;top:20px');
  });
  it('rewrites the root box and nested styles, the rest of the file untouched', () => {
    const src = `<x-dc>\n<div style="width:1200px;height:760px;display:flex"><p style="font-size:24px;width:600px">Hi {{name}}</p></div>\n</x-dc>`;
    const out = adaptSize(src, [1200, 760], [600, 760]);
    expect(out).toContain('width:600px;height:760px;display:flex');
    expect(out).toContain('font-size:12px;width:300px">Hi {{name}}</p>');
  });
  it('says when the aspect ratio moved too far for a rescale alone', () => {
    expect(needsRelayout([1920, 1080], [1080, 1920])).toBe(true);
    expect(needsRelayout([1920, 1080], [1440, 900])).toBe(false);
  });
});
