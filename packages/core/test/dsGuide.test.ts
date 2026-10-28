import { describe, expect, it } from 'vitest';
import { consumingGuide, resolveTokens, withConsumingGuide } from '../src';

const tokens = resolveTokens({
  name: 'Ember',
  color: {
    themes: [{ id: 'light', name: 'Light' }, { id: 'dark', name: 'Dark' }],
    tokens: [
      { name: 'ink', value: { light: '#111111', dark: '#eeeeee' }, usage: 'Text.' },
      { name: 'accent', value: '#2f6fed' },
      { name: 'accent-hover', value: '#1d4ed8' },
      { name: 'gray-100', value: '#f4f4f4' },
      { name: 'gray-500', value: '#888888' },
      { name: 'gray-900', value: '#222222' },
    ],
  },
  type: {
    families: { sans: 'Acme Sans, sans-serif' },
    fonts: [{ family: 'Acme Sans', file: 'AcmeSans.ttc', weight: '400' }],
    groups: [{ name: 'Text', family: 'sans', styles: [{ name: 'quote', fontSize: '20px', lineHeight: 1.4, fontStyle: 'italic', letterSpacing: '0.02em' }] }],
  },
  spacing: { tokens: [{ name: 'space-2', value: '8px' }] },
});

describe('consumingGuide', () => {
  const md = consumingGuide(tokens);

  it('tells where tokens.css goes, per theme', () => {
    expect(md).toContain('<link rel="stylesheet" href="tokens.css">');
    expect(md).toContain('cannot link a stylesheet');
    expect(md).toContain('data-theme="<id>"');
  });

  it('writes a colour with its variable and fallback, and sets ramps and states apart', () => {
    expect(md).toContain('`var(--ink, #111111)`');
    expect(md).toContain('Interaction states:');
    expect(md).toContain('Ramp `gray`, variables `--gray-<step>`:\n- 100 `#f4f4f4`, 500 `#888888`, 900 `#222222`');
    expect(md).not.toMatch(/\| `gray-100`/);
  });

  it('lists families and the type styles with italic and letter spacing', () => {
    expect(md).toContain('`var(--font-sans)`');
    expect(md).toMatch(/\| `quote` \| `\.quote` \| `sans` \| `20px` \| 1.4 \| {2}\| yes \| 0.02em/);
  });

  it('keeps a .ttc as a file and says browsers will not load it', () => {
    expect(tokens.fonts[0].file).toBe('fonts/AcmeSans.ttc');
    expect(md).toContain('a font collection');
  });

  it('lists a ramp once when the themes agree, per theme when they differ', () => {
    const dark = resolveTokens({
      color: {
        themes: [{ id: 'light', name: 'Light' }, { id: 'dark', name: 'Dark' }],
        tokens: [
          { name: 'sand-100', value: { light: '#f6efe3', dark: '#2a241a' } },
          { name: 'sand-300', value: { light: '#e3d2b4', dark: '#4a3f2a' } },
          { name: 'sand-500', value: { light: '#b99a63', dark: '#8a7340' } },
        ],
      },
    });
    const g = consumingGuide(dark);
    expect(g).toContain('- Dark: 100 `#2a241a`, 300 `#4a3f2a`, 500 `#8a7340`');
    expect(md).not.toContain('- Light: 100 `#f4f4f4`');
  });
});

describe('withConsumingGuide', () => {
  it('appends once, then replaces in place', () => {
    const a = withConsumingGuide('# Ember\n\nBrand book.\n', 'G1');
    expect(a).toBe('# Ember\n\nBrand book.\n\nG1\n');
    const g = consumingGuide(tokens);
    const once = withConsumingGuide(a, g);
    expect(withConsumingGuide(once, g)).toBe(once);
    const changed = withConsumingGuide(once, consumingGuide(resolveTokens({ color: { tokens: [{ name: 'ink', value: '#000000' }] } })));
    expect(changed.match(/Consuming this system/g)).toHaveLength(1);
    expect(changed.startsWith('# Ember\n\nBrand book.')).toBe(true);
  });

  it('is not fooled by a marker quoted above the appendix', () => {
    const quoted = '# Ember\n\nUse `<!-- consuming-this-system:begin -->` to mark it.\n';
    const g = consumingGuide(tokens);
    const once = withConsumingGuide(quoted, g);
    const again = withConsumingGuide(once, g);
    expect(again).toBe(once);
    expect(again.startsWith(quoted)).toBe(true);
  });
});
