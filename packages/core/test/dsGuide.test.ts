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
    expect(md).toContain('Ramp `gray`: 100 `#f4f4f4`, 500 `#888888`, 900 `#222222`');
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

  it('without tokens.css gives values only', () => {
    const plain = consumingGuide(tokens, { tokensCss: false });
    expect(plain).toContain('There is no `tokens.css` yet');
    expect(plain).not.toContain('var(--ink');
  });
});

describe('withConsumingGuide', () => {
  it('appends once, then replaces in place', () => {
    const a = withConsumingGuide('# Ember\n\nBrand book.\n', 'G1');
    expect(a).toBe('# Ember\n\nBrand book.\n\nG1\n');
    const g = consumingGuide(tokens);
    const once = withConsumingGuide(a, g);
    expect(withConsumingGuide(once, g)).toBe(once);
    const changed = withConsumingGuide(once, consumingGuide(tokens, { tokensCss: false }));
    expect(changed.match(/Consuming this system/g)).toHaveLength(1);
    expect(changed.startsWith('# Ember\n\nBrand book.')).toBe(true);
  });
});
