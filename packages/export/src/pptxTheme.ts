import type { PptxDeck, PptxTheme, PptxThemeColor } from './pptx';

/** The theme a deck's drawing implies, so PowerPoint's and Keynote's pickers offer the deck's own colours and
 * typefaces: the typeface of the titles (else the largest text) and the one most text is set in; the background
 * most of the pages wear as `lt1` or `dk1` with the text colour most used on it as the other, the next light and
 * dark as `lt2`/`dk2`, and the most used saturated colours (fills and text, by area and by characters) as accents.
 * A slot the deck says nothing about keeps Office's. Objects still carry their own colours: this is what the
 * package offers, not what it draws. */
export function pptxTheme(deck: PptxDeck): PptxTheme {
  const fonts = { title: new Map<string, number>(), body: new Map<string, number>(), big: new Map<string, number>() };
  const colours = new Map<string, number>(), backgrounds = new Map<string, number>(), text = new Map<string, number>();
  const add = (map: Map<string, number>, key: string | undefined, n: number) => { if (key && n > 0) map.set(key, (map.get(key) ?? 0) + n); };
  const page = deck.widthPx * deck.heightPx;
  let biggest = 0;
  for (const slide of deck.slides) for (const o of slide.objects) if (o.type === 'text') for (const p of o.paragraphs) for (const r of p.runs) biggest = Math.max(biggest, r.style?.fontSizePx ?? o.style.fontSizePx);
  for (const slide of deck.slides) {
    add(backgrounds, slide.background ?? 'FFFFFF', page);
    for (const o of slide.objects) {
      if (o.type === 'shape') add(colours, o.fill, (o.fillOpacity ?? 1) === 1 ? o.width * o.height : 0);
      if (o.type !== 'text') continue;
      for (const p of o.paragraphs) for (const r of p.runs) {
        const s = { ...o.style, ...r.style }, n = r.text.trim().length;
        add(o.role === 'title' ? fonts.title : fonts.body, s.fontFace, n);
        if (s.fontSizePx >= biggest * 0.6) add(fonts.big, s.fontFace, n);
        add(text, s.color ?? '000000', n);
        // a character of text counts as much as a square of its size
        add(colours, s.color ?? '000000', n * s.fontSizePx * s.fontSizePx);
      }
    }
  }
  const top = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const headingFont = top(fonts.title)[0] ?? top(fonts.big)[0];
  const bodyFont = top(fonts.body)[0] ?? headingFont;
  const colors: Partial<Record<PptxThemeColor, string>> = {};
  const all = new Map(colours);
  for (const [k, v] of backgrounds) add(all, k, v);
  const ranked = top(all);
  const lights = ranked.filter(c => luminance(c) >= LIGHT), darks = ranked.filter(c => luminance(c) < LIGHT);
  // the page most slides wear decides which of dk1/lt1 is the background; its text the other
  const bg = top(backgrounds)[0];
  if (bg && luminance(bg) >= LIGHT) { colors.lt1 = bg; colors.dk1 = top(text).find(c => luminance(c) < LIGHT) ?? darks[0]; }
  else if (bg) { colors.dk1 = bg; colors.lt1 = top(text).find(c => luminance(c) >= LIGHT) ?? lights[0]; }
  colors.lt2 = lights.find(c => c !== colors.lt1 && !near(c, colors.lt1));
  colors.dk2 = darks.find(c => c !== colors.dk1 && !near(c, colors.dk1));
  const accents: string[] = [];
  for (const c of ranked) {
    if (accents.length === 6) break;
    if (chroma(c) < 0.2 || Object.values(colors).some(v => v && near(v, c)) || accents.some(a => near(a, c))) continue;
    accents.push(c);
  }
  accents.forEach((c, i) => { colors[`accent${i + 1}` as PptxThemeColor] = c; });
  if (accents[0]) colors.hlink = accents[0];
  for (const k of Object.keys(colors) as PptxThemeColor[]) if (!colors[k]) delete colors[k];
  return { ...(headingFont ? { headingFont } : {}), ...(bodyFont ? { bodyFont } : {}), ...(Object.keys(colors).length ? { colors } : {}) };
}

/** Relative luminance as far from black as from white in contrast: lighter is a light colour. */
const LIGHT = 0.18;
const rgb = (c: string) => [0, 2, 4].map(k => parseInt(c.slice(k, k + 2), 16) / 255);
function luminance(c: string): number {
  const [r, g, b] = rgb(c).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
/** How far a colour is from grey (HSV chroma): pale tints and greys of any hue stay low. */
function chroma(c: string): number {
  const v = rgb(c);
  return Math.max(...v) - Math.min(...v);
}
function near(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const x = rgb(a), y = rgb(b);
  return x.reduce((n, v, i) => n + Math.abs(v - y[i]!), 0) < 0.08;
}
