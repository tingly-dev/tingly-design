import { afterEach, describe, expect, it, vi } from 'vitest';
import { fontCss, inlineFontLinks } from '../src/rasterize';

const SHEET = `
/* latin */
@font-face { font-family: 'Inter'; src: url(https://fonts.example/latin.woff2) format('woff2'); unicode-range: U+0000-00FF, U+0131; }
/* cyrillic */
@font-face { font-family: 'Inter'; src: url(https://fonts.example/cyrillic.woff2) format('woff2'); unicode-range: U+0400-045F; }
`;

function network() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).endsWith('.css')) return new Response(SHEET);
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'font/woff2' } });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('fontCss', () => {
  it('inlines only the faces whose range covers the text', async () => {
    network();
    const css = await fontCss(['https://fonts.example/css2?x.css'], 'Hello');
    expect(css).toContain('data:font/woff2;base64,AQID');
    expect(css).not.toContain('https://fonts.example/latin');
    expect(css.match(/@font-face/g)).toHaveLength(1);
  });

  it('takes the other range when the text needs it', async () => {
    network();
    const css = await fontCss(['https://fonts.example/css2?x.css'], 'Привет');
    expect(css.match(/@font-face/g)).toHaveLength(2);
  });

  it('skips a sheet that cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect(await fontCss(['https://fonts.example/css2?x.css'], 'a')).toBe('');
  });

  it('asks Google Fonts for just the characters in use, a few hundred at a time', async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        asked.push(String(url));
        if (String(url).includes('fonts.googleapis.com')) {
          const text = new URL(url).searchParams.get('text') ?? '';
          return new Response(`@font-face { font-family: 'Noto Sans SC'; src: url(https://fonts.gstatic.com/l/font?kit=${asked.length}) format('woff2'); unicode-range: ${[...text].map((c) => 'U+' + c.codePointAt(0)!.toString(16)).join(', ')}; }`);
        }
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'font/woff2' } });
      }),
    );
    const text = Array.from({ length: 400 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
    const css = await fontCss(['https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400&display=swap'], text + text);
    const sheets = asked.filter((u) => u.includes('googleapis'));
    expect(sheets).toHaveLength(2);
    expect(new URL(sheets[0]).searchParams.get('text')).toHaveLength(300);
    expect(new URL(sheets[0]).searchParams.get('family')).toBe('Noto Sans SC:wght@400');
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain('base64,AQID');
  });

  it('falls back to the whole sheet when a cut cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('text=')) return new Response('', { status: 400 });
        if (String(url).includes('googleapis')) return new Response(SHEET);
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'font/woff2' } });
      }),
    );
    const css = await fontCss(['https://fonts.googleapis.com/css2?family=Inter'], 'Hello');
    expect(css.match(/@font-face/g)).toHaveLength(1);
  });

  it('wraps a single font file in a face', async () => {
    network();
    const css = await fontCss([{ family: 'My "Face"', url: 'https://fonts.example/my.woff2' }], 'a');
    expect(css).toContain('font-family:"My Face"');
    expect(css).toContain('base64,AQID');
  });
});

describe('inlineFontLinks', () => {
  it('turns a hosted stylesheet link into inline faces and leaves other links alone', async () => {
    network();
    const html = '<head><link rel="stylesheet" href="https://fonts.example/css2?x.css"><link rel="icon" href="https://fonts.example/i.png"><link rel="stylesheet" href="/local.css"></head>';
    const out = await inlineFontLinks(html, 'Hello');
    expect(out).toContain('<style>@font-face');
    expect(out).toContain('data:font/woff2;base64,AQID');
    expect(out).not.toContain('fonts.example/css2');
    expect(out).toContain('<link rel="icon"');
    expect(out).toContain('href="/local.css"');
  });

  it('keeps the link when the sheet cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    const html = '<link rel="stylesheet" href="https://fonts.example/css2?x.css">';
    expect(await inlineFontLinks(html, 'a')).toBe(html);
  });
});
