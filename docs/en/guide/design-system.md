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

- **Pages**: overview (a sample card in the system's own colours, fonts and corner radius, its typefaces, shape, themes and counts, the full palette, then the cover and brand book with the Markdown editable in place; the launcher card draws the cover, with the components' styles, or the same sample when there is no cover, so two systems differ at a glance), colours (switch themes; a usage note that says "on surface" shows the contrast on that surface; aliases show what they point to), type (each style rendered in its own face and size), spacing, radius and shadow, components (each preview loads tokens.css, bundle.css and bundle.js in a sandbox), and assets (upload, download and delete per group).
- **Import / Export**: the “Import / Export” button at the bottom of the left column brings in fonts and images, and saves the page you are on (overview, colours, type…) as a PNG, or copies it to the clipboard (“Copy as PNG”). Component previews run in their own frames and come out blank in it. At the end of the same menu, “Whole project (.zip)” saves the project itself: every file and its change log; “Project files only (.zip)” leaves the change log out. “Import a project package (.zip)…” in the home page's New menu opens it again (a name already taken gets `-2`), and so does a project folder you zipped yourself.
- **Edit tokens in place**: open a row to change its value, rename it (aliases follow), write its usage, add or remove it. The edit is saved as data in tokens.json, and tokens.css is rebuilt with only the lines that changed.
- **Shadows** are written as CSS box-shadows. A shadow may name one of the system's own colours as `var(--accent)`, so it follows the theme; no other `var()` is read.
- **Checks**: anything in tokens.json outside the original grammar (colour names, `var()` in a colour, missing or circular aliases, DTCG maps…) is dropped and listed under 问题 (issues) with the reason.
- **Install into a canvas or deck**: in that project's panel, with nothing selected, pick the system under 设计系统 and install it. tokens.json is copied to `ds/<folder>/` in that project and recorded in its `designSystems`; from then on every colour field has a ◆ to pick its colours and shows which token the current value is, and the text-style menu lists its styles. A deck also gets the system's typefaces. Slides store the colour value itself, since the subset has no `var()`.
- **Switch a whole canvas or deck to a theme**: once a system is installed, the **Theme** tab of the right panel (canvas and slides) shows one card per theme of every installed system, plus Original look. One click rewrites every artboard (or every slide, or only the open slide: a deck asks “Apply to”) so the colours that stood for the page, cards, text, lines and accent become the chosen theme's; a deck also takes its typefaces. The colours are ordinary values in the files, not variables. The toast has Undo (and ⌘Z takes the whole switch back at once); Original look puts back what the first switch replaced. Under the cards: the theme the work wears now, how many colours belong to no system and stay as they were (with an offer to ask Claude to restyle them), the theme's colours by role, and the contrast of its text on what it is drawn on.
- **Hosted fonts**: `type.hosted: [{family, href}]` in tokens.json is an extension of this repository (the original only reads font files) that loads Google Fonts css2 links, in previews and in decks that install the system.
- **AI**: like the original, the design system page has no in-page model; changes go to Claude Code.
- **Import**: the import button at the bottom of the left bar, or drop files in. Font files join the fonts (registered in `tokens.json`); pictures and SVGs join the assets' Other group.

Format reference: [`.claude/skills/design-system/SKILL.md`](../../../.claude/skills/design-system/SKILL.md)

---

Back to the [README](../../../README.md)

## Start from a look

A new design system can start blank or from one of 36 looks, in five groups by feel: Clean and light, Editorial, Bold and playful, Technical, Editor palettes. In the New dialog pick Design system, then a group, then a look (each is drawn in its own page colour, ink, accent and type). From the command line:

```bash
tingly-design new design-system acme --look swiss-grid
```

A look sets the colours (in one theme), font families, corner radii and shadows; text styles and spacing are generic, and the README credits the look's source (the themes of the html-ppt template, MIT). It also comes with the look's components (Title, Kicker, Card, Pill and Divider, drawn with the theme's own borders, shadows and gradients) and a cover in the look, so the overview shows what the look is at a glance. It is a starting point, not a link: the system is yours to edit afterwards.

Template names keep their original English in every interface language. When creating a canvas or slide deck, expand **Built-in** under the design system field to choose a template by group. The same picker is available in the editor’s design system panel, even with no design system projects yet. Selecting a template closes the group and displays its name. Its tokens are copied directly into the project; no separate design system project is created. A slide deck that is still only its starter cover takes the look’s paint right away: the cover is redrawn in the look’s page colour, ink and title face, so what you picked is what you see first. A deck you have already designed keeps its slides.
