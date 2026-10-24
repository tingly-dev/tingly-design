import { describe, expect, it } from 'vitest';
import { adaptSize, adaptStyle, needsRelayout, seedFormat } from '../src';

describe('adaptSize', () => {
  it('scales each axis and keeps type at the smaller factor', () => {
    expect(adaptStyle('width:400px;height:200px;font-size:20px;padding:10px 20px', 0.5, 0.25)).toBe('width:200px;height:50px;font-size:5px;padding:2.5px 10px');
  });
  it('keeps a small box square', () => {
    expect(adaptStyle('width:24px;height:24px;border-radius:6px', 0.5, 1)).toBe('width:12px;height:12px;border-radius:3px');
  });
  it('rewrites the right declaration when names overlap', () => {
    expect(adaptStyle('border-top:2px;top:2px', 1, 2)).toBe('border-top:2px;top:4px');
    expect(adaptStyle('min-width:100px;width:100px', 2, 2)).toBe('min-width:200px;width:200px');
  });
  it('scales a one-value box shorthand by the smaller factor', () => {
    expect(adaptStyle('padding:24px', 0.5, 2)).toBe('padding:12px');
    expect(adaptStyle('padding:24px 10px', 0.5, 2)).toBe('padding:48px 5px');
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

describe('seedFormat', () => {
  it('writes the changes as data-<format> overrides and leaves the style alone', () => {
    const src = '<section id="a" style="padding:128px;display:flex"><h2 style="font-size:96px">Hi</h2><p>plain</p></section>';
    const out = seedFormat(src, [1920, 1080], [1080, 1920], 'tall');
    expect(out).toContain('<section id="a" style="padding:128px;display:flex" data-tall="padding:');
    expect(out).toContain('<h2 style="font-size:96px" data-tall="font-size:54px">');
    expect(out).toContain('<p>plain</p>');
  });
  it('skips an element that already has an override for the format', () => {
    const src = '<section id="a" style="padding:100px" data-tall="padding:10px"></section>';
    expect(seedFormat(src, [1920, 1080], [1080, 1920], 'tall')).toBe(src);
  });
});
