import { afterEach, describe, expect, it, vi } from 'vitest';
import { fontCss } from '../src/rasterize';

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

  it('wraps a single font file in a face', async () => {
    network();
    const css = await fontCss([{ family: 'My "Face"', url: 'https://fonts.example/my.woff2' }], 'a');
    expect(css).toContain('font-family:"My Face"');
    expect(css).toContain('base64,AQID');
  });
});
