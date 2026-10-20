---
name: design-system
description: Read before creating or editing a design system under projects/ (design-system.json, tokens.json, README.md, components/, assets/, fonts/) — the file layout, the tokens.json grammar the page reads, the preview contract, and how canvases and decks install a system.
---

# Design systems

A design system is a folder under `projects/<name>/`, laid out as the original Design System type lays out `project/`:

| path | what |
|---|---|
| `design-system.json` | the index: `{"v":3,"layout":"files","createdOnFiles":{…},"title","namespace","libraries":[],"sections":{},"groups":[…],"assetGroups":{…},"blobs":{},"docs":{"readme":"project/README.md","sections":[]},"lastChange":{…}}`. `title` is the system's name; `namespace` the global `components/bundle.js` assigns. Keep every key you are not changing. |
| `tokens.json` | the tokens (grammar below). JSON, two-space indentation. |
| `tokens.css` | **generated** from tokens.json by the editor whenever tokens.json changes — never write it. |
| `README.md`, other `*.md` | the brand book; other top-level `*.md` files are further sections. |
| `components/<Comp>/README.md` | guidelines; the first sentence is the summary. `<Comp>` is an ASCII identifier. |
| `components/<Comp>/preview.html` | a live preview (contract below). `components/Cover/preview.html` is the cover above the brand book. |
| `components/bundle.js` | ONE classic script assigning `window.<namespace>`; line 1 `/* @ds-bundle: {"format":4,"namespace":"…","components":[{"name":"…"}]} */` orders the components. No `import`, no network, no literal `</script`. |
| `components/bundle.css`, `components/index.d.ts` | the stylesheet (loaded after tokens.css) and the props as types. |
| `assets/<Group>/<file>` | logos, icons, images; `assets/<Group>/README.md` says what each is (and names a single-ink mark's ink). |
| `fonts/<file>` | font files, listed by `tokens.json` `type.fonts[].file`. |

The editor (`pnpm dev`, http://localhost:5173/?p=<name>) shows the system — overview with the cover and brand book, colours per theme with contrast, type, spacing/radius/shadow, live component previews, assets — and edits tokens in place. `projects/tingly-ds` is a full example: two themes, Instrument Serif and Inter, four components; the deck in `projects/tingly-intro` is built from it.

## Starting from a look

`tingly-design new design-system <name> --look <id>` (or the New dialog's "Start from a look") writes a system from one of 36 ready-made looks instead of the blank starter: its colours (one theme), font families, radii and shadows, plus the generic text styles and spacing, and a README that keeps the look's MIT credit. The ids: clean `minimal-white corporate-clean swiss-grid arctic-cool soft-pastel xiaohongshu-white pitch-deck-vc`; editorial `editorial-serif magazine-bold academic-paper news-broadcast japanese-minimal midcentury`; bold `bauhaus memphis-pop neo-brutalism rainbow-gradient sunset-warm y2k-chrome vaporwave`; tech `blueprint engineering-whiteprint cyberpunk-neon terminal-green retro-tv sharp-mono glassmorphism aurora`; palettes `catppuccin-latte catppuccin-mocha dracula gruvbox-dark nord rose-pine solarized-light tokyo-night`. It also writes `components/`: `bundle.css` (the look's own rules, classes `lk-h1` `lk-h2` `lk-kicker` `lk-eyebrow` `lk-lede` `lk-card` `lk-card-soft|outline|accent` `lk-pill` `lk-pill-accent` `lk-divider` `lk-divider-accent` `lk-gradient-text` `lk-dim`), `bundle.js` with Title, Kicker, Card, Pill and Divider, their READMEs and previews, and a Cover in the look. Build new components on those classes so they keep the look. A look is only a start: edit tokens.json and the components afterwards like any other system, and keep the README's credit line.

## tokens.json

```json
{
  "name": "Acme",
  "version": 1,
  "color": {
    "themes": [{ "id": "light", "name": "Light" }, { "id": "dark", "name": "Dark" }],
    "tokens": [
      { "name": "surface", "value": { "light": "#fbf7f1", "dark": "#1d1a17" }, "usage": "Page background." },
      { "name": "ink", "value": { "light": "#2b2118", "dark": "#f3ece3" }, "usage": "Text, on surface." },
      { "name": "link", "value": "{ember}", "usage": "An alias of ember." }
    ]
  },
  "type": {
    "fonts": [{ "family": "Acme Sans", "file": "fonts/AcmeSans-Regular.woff2", "weight": "400" }],
    "hosted": [{ "family": "Noto Sans SC", "href": "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap" }],
    "families": { "sans": "\"Acme Sans\", system-ui, sans-serif" },
    "groups": [{ "name": "Text", "family": "sans", "styles": [{ "name": "body", "fontSize": "16px", "lineHeight": 1.5, "fontWeight": 400, "usage": "Running text." }] }]
  },
  "spacing": { "tokens": [{ "name": "space-4", "value": "16px", "usage": "Card padding." }] },
  "radius": { "tokens": [{ "name": "radius-m", "value": "8px", "usage": "Buttons, cards." }] },
  "shadow": { "tokens": [{ "name": "raised", "value": "0 2px 8px rgba(0,0,0,0.12)", "usage": "Menus." }] }
}
```

What the page reads (anything else drops, and the editor's 问题 view says why):

- Every family but `type` is a **list** of `{name, value, usage}`. A name-to-value map (DTCG / W3C tokens) is not read: turn it into lists.
- Names: `[A-Za-z0-9][A-Za-z0-9_.-]{0,63}`, each used once across every family but type.
- Colours: hex (`#rgb`, `#rrggbb`, with alpha too) or `rgb() rgba() hsl() oklch() oklab() lab() lch() color()` with plain numbers, or an alias `"{other-colour}"` of a colour that exists. No named colours, `var()`, `color-mix()`. A plain string is the first theme's value; a theme without a value inherits the first theme's — so put the primary theme first. At most 8 themes.
- Lengths (`fontSize`, `letterSpacing`, spacing, radius): `px`, `rem`, `em`, `%` or a number (px). `lineHeight`: a length or a unitless number under 10. `fontWeight`: 1–1000, `"300 800"`, `normal`, `bold`.
- `type.families`: font stacks ≤ 200 characters, no `; { } < > \` or functions. `type.fonts[].file` is a path under `fonts/`.
- `type.hosted` (this repository's extension; the original page keeps but ignores it): faces loaded from a `https://fonts.googleapis.com/css2?…` link. Installing the system into a deck turns them into the deck's typefaces.
- `shadow`: a box-shadow per token (or per theme like colours). A colour of the system may appear as `var(--colour)` (only that exact form, only a colour token), so the shadow follows the theme: `0 0 24px var(--accent)`; any other `var()` or `url()` drops the token. Any other top-level `{tokens:[…]}` key (`opacity`, `zIndex`…) becomes its own section. There is no motion family.
- Every token gets a `usage` note. A text colour's note names the surfaces it is legible on — "on surface and surface-raised" — and the editor shows the contrast on each.

## preview.html

```html
<!-- @dsCard group="Actions" height=88 subtitle="Two states" -->
<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
<div id="root"></div>
<script>
  document.getElementById('root').appendChild(Acme.Button({ label: 'Save' }));
</script>
</body>
</html>
```

- Line 1 is the marker: `group` sections the list, `height` is the row height (40–4000), `subtitle` a short note.
- The frame has already loaded tokens.css, bundle.css, the `libraries` the index lists, and bundle.js, and set `<html data-theme="<first theme>">`. Render one component in a few states; use `var(--token)` for every colour and length.
- No `<iframe>`, `<object>`, `<embed>`. Images by relative path (`../../assets/Logos/mark.svg`) or `data:`. Nothing loads from the network but the pinned script CDNs (an exact version: `react@18.3.1`) and Google Fonts.

## Installing into a canvas or deck

A canvas or deck installs a system from its panel (nothing selected → 设计系统). Installing copies `tokens.json` to `ds/<folder>/tokens.json` in that project (and the font files it names to `ds/<folder>/fonts/…`), and adds `{"title","namespace":"<folder>","artifact":"projects/<system>","version","copiedAt"}` to the index's `designSystems`. `<folder>` is the namespace lowercased, other characters as `-`. Then colour fields offer the system's colours and the text style menu its styles; a deck also gets the system's fonts as typefaces. Re-install to pick up later changes.

## Craft

- Build from real sources (the codebase's styles and components, the brand's files): enumerate the inventory first, copy exact values, copy logos and fonts as files — never approximate a mark or invent a brand.
- Nothing to build from? A small first system: 6–10 colours in one theme, 5–7 text styles, 4 spacing steps, 3 radii, a one-paragraph README; say so.
- README is a brand book: voice, visual foundations, iconography, with real examples; usage rules that name tokens.
- Text holds 4.5:1 on the surfaces its note names, in every theme (3:1 at 24px and up). Colours that must be told apart differ in lightness, not hue alone.
- No AI tropes: blue-purple gradients, emoji cards, left-border accent cards.

## Punctuation

Text people read (on the page, in notes, titles and descriptions) uses its language's own punctuation: in English the curly apostrophe (’) and quotation marks (“ ” and ‘ ’), in Chinese full-width punctuation and the quotation marks the text already uses (“ ” or 「 」). Straight quotes only as code, HTML, CSS or JSON syntax, and for feet and inches.

## Look at what you made

`tingly-design check <name> --snapshots` checks the files and draws each view (overview, colors, type, space, components, assets) as the editor's Export menu does, into `projects/<name>/renders/check/`. Read the PNGs to see the result; anything listed as "could not be drawn" is broken, and so is a script that "threw while the editor showed it"; "lists …, which is missing" names a file you referenced that is not there, and "did not load" a picture, font, style or script that never arrived. Warnings about the layout (text "cut off by its box", text that "runs past the edge", text "hard to read on its background", "nothing is drawn") are worth fixing unless the design means it. `tingly-design export <name> --as png --view <view>` draws one view. Component previews are frames and come out empty in these pictures. Run `tingly-design` as the editor that started you ships it, so it sees the same projects folder and version: `node cli.mjs …` when `cli.mjs` is in the working directory (the shipped bundle), `pnpm tingly-design …` in this repository, otherwise the installed `tingly-design …`; not `npx`, which may fetch another version. With Tingly Design's MCP server connected (`tingly-design mcp`, or the editor's `/mcp`), its `check`, `look` and `export` tools do the same (`look` hands the pictures back, one thing at a time with `pick`).
