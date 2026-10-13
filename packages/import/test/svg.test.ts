import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { decodeDataUrl, embeddedAssets, parseSvg, readSvg, svgLength, svgSize, toCanvas } from '../src';

const parser = new new Window().DOMParser() as unknown as DOMParser;
const read = (text: string) => readSvg(parseSvg(text, parser));
const png = `data:image/png;base64,${'A'.repeat(4000)}`;

describe('svg sizes', () => {
  it('reads lengths in any absolute unit', () => {
    expect(svgLength('640')).toBe(640);
    expect(svgLength('1in')).toBe(96);
    expect(svgLength('100%')).toBeNull();
  });
  it('falls back to the viewBox, keeping its aspect', () => {
    const doc = parseSvg('<svg xmlns="http://www.w3.org/2000/svg" width="200" viewBox="0 0 100 50"/>', parser);
    expect(svgSize(doc.documentElement)).toEqual({ w: 200, h: 100, known: true });
  });
});

describe('readSvg', () => {
  const svg = `﻿<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="300" height="200" onload="x()">
  <title>Card</title>
  <metadata>junk</metadata>
  <script>alert(1)</script>
  <rect width="300" height="200" fill="rgb(47, 111, 237)" inkscape:label="bg"/>
  <text x="10" y="40" style="font-size: 24px">Hi {{name}}</text>
  <image xlink:href="${png}" width="10" height="10"/>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>
</svg>
pasted note after the drawing`;

  it('keeps the drawing, drops what the canvas cannot hold, and counts it', () => {
    const x = read(svg);
    expect(x).toMatchObject({ from: 'svg', title: 'Card', width: 300, height: 200 });
    expect(x.report).toMatchObject({ scripts: 1, dropped: { foreignObject: 1 } });
    expect(x.urls).toEqual([png]);
    const drawing = x.root.children[0];
    expect(drawing.kind === 'el' && drawing.attrs.map(([k]) => k)).toEqual(['width', 'height', 'viewBox']);
  });

  it('writes one artboard with text editable and embedded images as assets', () => {
    const x = read(svg);
    const assets = embeddedAssets(x.urls);
    expect(assets.map((a) => a.ext)).toEqual(['png']);
    const out = toCanvas(x, { now: 'x', source: 'card.svg', mapUrl: (u) => (u === png ? 'assets/e.png' : undefined) });
    const html = out.files['Main.dc.html'];
    expect(html).toContain(`<text x="10" y="40" style="font-size: 24px;">Hi {{ '{{' }}name}}</text>`.replace(';', ''));
    expect(html).toContain('<image href="assets/e.png"');
    expect(html).toContain('fill="rgb(47, 111, 237)"');
    expect(html).not.toMatch(/onload|inkscape|alert|metadata/);
    const canvas = JSON.parse(out.files['canvas.json']);
    expect(canvas.imported.from).toBe('svg');
    expect(canvas.boards['Main.dc.html']).toMatchObject({ w: 300, h: 200, title: 'Card' });
    expect(canvas.notes.imported.text).toContain('从 SVG 导入');
  });

  it('notes outlined text', () => {
    const paths = '<path d="M0 0h1"/>'.repeat(3);
    expect(read(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${paths}</svg>`).report.notes?.[0]).toMatch(/没有可改的文字/);
  });

  it('rejects what is not an svg', () => {
    expect(() => read('<html></html>')).toThrow();
  });
});

describe('data urls', () => {
  it('decodes base64 and percent-encoded data', () => {
    expect(decodeDataUrl('data:image/png;base64,AQID')).toEqual({ type: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
    expect(new TextDecoder().decode(decodeDataUrl('data:image/svg+xml,%3Csvg%3E')!.bytes)).toBe('<svg>');
  });
  it('leaves small ones inline', () => {
    expect(embeddedAssets(['data:image/png;base64,AQID'])).toEqual([]);
  });
});
