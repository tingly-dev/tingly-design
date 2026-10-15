<p align="right"><b>English</b> · <a href="../../zh/guide/design-system.md">简体中文</a></p>

# Design system

The sample [`?p=tingly-ds`](http://localhost:5173/?p=tingly-ds) is the Tingly design system: the colours (light and dark), typefaces, type sizes, spacing and components the console mockups, the deck and the dashboard share, taken from the Tingly Box homepage and web UI.

| Overview: cover and brand book | Colours: usage and contrast |
|---|---|
| ![Design system overview](../../images/design-system.png) | ![Design system colours](../../images/design-system-colors.png) |

```
projects/<name>/
  design-system.json      the index: title, namespace, asset groups
  tokens.json             colours (per theme), type, spacing, radius, shadow…, each a list of {name, value, usage}
  tokens.css              generated from tokens.json (rebuilt whenever the editor, Claude Code or a terminal changes it)
  README.md, *.md         the brand book
  components/<C>/         README.md (guidelines) and preview.html (a live preview); Cover is the cover
  components/bundle.js    the components, assigned to window.<namespace>; bundle.css, index.d.ts
  assets/<group>/, fonts/ logos, icons, images and font files
```

- **Pages**: overview (a sample card in the system's own colours, fonts and corner radius, its typefaces, shape, themes and counts, the full palette, then the cover and brand book with the Markdown editable in place; the launcher card draws the same sample, so two systems differ at a glance), colours (switch themes; a usage note that says "on surface" shows the contrast on that surface; aliases show what they point to), type (each style rendered in its own face and size), spacing, radius and shadow, components (each preview loads tokens.css, bundle.css and bundle.js in a sandbox), and assets (upload, download and delete per group).
- **Save as image**: the picture button at the bottom of the left column saves the page you are on (overview, colours, type…) as a PNG. Component previews run in their own frames and come out blank in it.
- **Edit tokens in place**: open a row to change its value, rename it (aliases follow), write its usage, add or remove it. The edit is saved as data in tokens.json, and tokens.css is rebuilt with only the lines that changed.
- **Checks**: anything in tokens.json outside the original grammar (colour names, `var()`, missing or circular aliases, DTCG maps…) is dropped and listed under 问题 (issues) with the reason.
- **Install into a canvas or deck**: in that project's panel, with nothing selected, pick the system under 设计系统 and install it. tokens.json is copied to `ds/<folder>/` in that project and recorded in its `designSystems`; from then on every colour field has a ◆ to pick its colours and shows which token the current value is, and the text-style menu lists its styles. A deck also gets the system's typefaces. Slides store the colour value itself, since the subset has no `var()`.
- **Hosted fonts**: `type.hosted: [{family, href}]` in tokens.json is an extension of this repository (the original only reads font files) that loads Google Fonts css2 links, in previews and in decks that install the system.
- **AI**: like the original, the design system page has no in-page model; changes go to Claude Code.
- **Import**: the import button at the bottom of the left bar, or drop files in. Font files join the fonts (registered in `tokens.json`); pictures and SVGs join the assets' Other group.

Format reference: [`.claude/skills/design-system/SKILL.md`](../../../.claude/skills/design-system/SKILL.md)

---

Back to the [README](../../../README.md)
