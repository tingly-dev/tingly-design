# Typefaces and the look

Adapted from the original Slides type's reference; rules here hold for Tingly Design's slide subset.

Read this part when you choose the typefaces and colors for the deck, or when a user gives you font files. There is no house typeface, and nothing is bundled. You choose the typefaces that fit the brief. The deck states the typefaces in `deck.json` `faces`.

**The normal case is a web font, which is a Google Fonts stylesheet link. It looks like this:**

```
"faces": {
  "heading-face": { "family": "Heading Face", "href": "https://fonts.googleapis.com/css2?family=Heading+Face:wght@400..800&display=swap" },
  "text-face": { "family": "Text Face", "href": "https://fonts.googleapis.com/css2?family=Text+Face:wght@400;600&display=swap" }
}
```

For each family, write `family=` and the font name. Replace spaces in the name with `+`. You can add `:wght@` and a range or list of weights. Do not use `%` escapes. Only links that start with `https://fonts.googleapis.com/css2?` are allowed. Each entry's key is the family lowercased, spaces as `-`.

Each family you list becomes a typeface you can use in the deck. To use a typeface, write its name like this:

- `<section style="font-family:'Text Face', Arial, sans-serif">` on every slide, for the whole deck.
- `font-family:'Heading Face', Georgia, serif` on headings, or set it once per section so it is inherited.
- Put names with spaces inside quotes.
- End with a basic face, then the generic (`sans-serif`, `serif`, `monospace`, `cursive`). Basic faces work on any computer: Arial, Verdana, Tahoma, Trebuchet MS, Georgia, Times New Roman, Courier New, Brush Script MT.

Use 4 or fewer families in a deck. Two is the norm.

**A design system** installed in the deck lives in `ds/<folder>/` and is recorded in `deck.json` `designSystems`. Its look is its tokens: take the palette, type scale and typefaces from its `tokens.json`, and read its README first and whole where it has one; no README (a new system may have none yet): its look is `tokens.json` alone, and say its README is missing. Its fonts are installed with the system, under `ds/<folder>/`, and that path is the family's `src` in `deck.json` `faces` (keyed as above).

**If the user or a design system gives you a font file** (for example a brand font, or any font that is not on Google Fonts), put the .woff2, .woff, .ttf, or .otf file in the deck folder (for example `assets/AcmeSans.woff2`). Then name it in `deck.json` `faces`:

```
"acme-sans": { "family": "Acme Sans", "src": "assets/AcmeSans.woff2" }
```

Leave a face's `src` exactly as it is when you edit a deck.

Never write a font as a `data:` URI. If you do not have the file, do not declare that face: use a Google Fonts or basic face instead, and tell the user.

A static font file with only one weight will render every weight at that one weight. Prefer a variable font file, or the single weight you use the most.

Symbols that the typeface does not include (for example ✓ ✗ ★ ☐ and most dingbats) fall back to a system font. For a check mark, write `<x-icon name="Check">`. For a "no", use a word or a plain −.

## Default picks — prefer these unless the brief says otherwise

All of these are Google Fonts families. Load each one you choose as a `faces` entry whose `href` names it as `family=Name+With+Spaces` plus a `:wght@` range covering the weights you use, names exactly as shown here.

**Text (body) typeface — choose ONE. If your deck uses only one typeface, it will be this one.**

- sans: `DM Sans` (modern consumer) · `Nunito Sans` (friendly neutral) · `Rubik` (soft-cornered grotesk, product) · `IBM Plex Sans` (technical, enterprise) · `Public Sans` (civic, quiet)
- rounded: `Nunito` (education, wellness) · `Quicksand` (light, airy) · `Fredoka` (kids, bold consumer)
- serif: `EB Garamond` (academic, heritage) · `Libre Baskerville` (editorial, reports)
- slab: `Domine` (friendly-serious)
- mono: `JetBrains Mono` · `Fira Code` (developer decks, code)

**Display (heading) typeface — choose ONE from a different row than your text typeface.**

- sans: `DM Sans` · `Rubik`
- serif: `EB Garamond` · `Libre Baskerville` · `Cormorant Garamond` (delicate; use only at display sizes)
- slab: `Domine`
- condensed: `Oswald` (posters, sports, statements)
- rounded: `Nunito` · `Fredoka`
- calligraphic: `Dancing Script` (use for only one line, never for body text)
- hand-drawn: `Caveat` (use for one accent line, never for body text)

You can also use any other typeface on Google Fonts, like Playfair Display, Lora, Bitter, Work Sans, Space Grotesk, Montserrat, Syne, and others. This is fine when you have a deliberate design direction.

## Pairings by mood (headings + text)

- Editorial / magazine: `Rubik` + `Libre Baskerville`, or just `Libre Baskerville` (headings at 700)
- Luxury / hospitality: `Cormorant Garamond` + `Rubik` (light)
- Institutional / research / policy: `EB Garamond` + `IBM Plex Sans`, `Libre Baskerville` + `Public Sans`, or `Source Serif 4` + `IBM Plex Sans`
- Literary / non-profit / education: `Domine` + `Nunito Sans`, or just `Libre Baskerville`
- Academic / heritage: just `EB Garamond` (headings at 600)
- Product / startup / SaaS: just `DM Sans`, or `Rubik` + `Domine`
- Developer / infrastructure: `IBM Plex Sans` + `JetBrains Mono`, or `Rubik` + `Fira Code`
- Bold / poster / sports: `Oswald` + `Public Sans`, or `Oswald` + `Rubik`
- Playful / consumer: `Fredoka` + `Nunito Sans`, just `Quicksand`, or a `Caveat` accent line over `Nunito Sans`
- Quiet / minimal: just `Public Sans`
- Celebratory / invitation: `Dancing Script` (one line) + `EB Garamond`

Vary between decks. Do not always reach for the same pairing. Do not choose a typeface only because it is first in a list.

## Rules that keep a deck from looking generic

The "Designing the deck" list in SKILL.md is the rule set. Here are the numbers behind it:

- **Two faces is the norm; a third only when it has a clear job.** One of them is the display face. A distinctive display face with a refined text face looks better than two safe faces.
- **Color in hex, chosen once.** Choose one dark color and one light color. You may also choose zero, one, or two accent colors. If you use two accents, they should share the same chroma and lightness but have different hues. Tone the whites and blacks toward the palette. For example, use `#FBFBF8` instead of pure white and `#14213D` instead of pure black. Never use raw `#FFFFFF` or `#000000` unless you want a stark look on purpose. Use two background tones per deck, plus the one accent statement slide. Add a `background` style to every section.
- **Contrast is a number.** Body text must have a contrast ratio of at least 4.5:1 against its background. At display sizes, the ratio must be at least 3:1. If you use a light accent color (like `#E8C547`), put dark text on it.
- **Color never says it alone.** A status, a good/bad split, the winning bar, a risk level or a highlighted cell also says so in its text ("+4%, over plan"; "High risk"); a dash, a ✓ or an icon standing for a word gets the word beside it (icons, shapes and connectors reach a screen reader as nothing).
- **The type scale is the hierarchy.** Use four or five font sizes. For example: 120 / 72 / 44 / 32 / 24. Reuse them across the deck. Use the accent color for eyebrows. Use the dark tone for headings on a light background, or the light tone on a dark background. For body text, use a softened dark color (like `#4A5568` on a light background, or `#BFD8D5` on a dark background).
- **Typographic punctuation.** In all the text people read (slides, speaker notes, the deck’s title, section descriptions), type `’` for the apostrophe and the quotation marks of the text’s language (`“ ”` in English, `« »` in French, `„ “` in German). Keep straight `'` and `"` as HTML, CSS and JSON syntax, in code shown on a slide, and for feet and inches.
