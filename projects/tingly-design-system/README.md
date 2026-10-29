# Tingly Design System

The shared look of the Tingly projects: [Tingly Box](https://github.com/tingly-dev/tingly-box), the open-source AI gateway that connects any agent to any model, and Tingly Design, the local design workspace this system lives in. The values come from the Tingly Box homepage and web UI; the sample deck (`projects/tingly-design-intro-slides`), the console mockups (`projects/tingly-box-console-canvas`) and the usage dashboard (`projects/tingly-box-usage-dashboard`) are built with it.

## Voice

- Say what it does, then how: "Any agent, any model, one endpoint", not "Next-generation AI orchestration".
- Name real things: agents, providers, protocols, ports, commands. `npx tingly-box@latest` beats "easy to install".
- Plain words, short sentences, no exclamation marks and no superlatives we cannot measure.

## Visual foundations

- **Paper, not white**: pages and slides sit on `paper`; cards, tables and code on `surface` with a 1px `line` border. Cards stay flat; `raised` is for menus, popovers and at most one featured card.
- **One accent**: `brand` blue marks the primary action, links and the one series a chart is about. Everything else stays in ink and gray.
- **Status colours mean status**: `positive` for healthy or connected, `negative` for errors, `warning` for degraded. Never decoration.
- **Two typefaces**: Instrument Serif (`display`) for titles and headline numbers, Inter (`sans`) for everything else. Titles are sentences in sentence case.
- **Type scale**: 136 / 76 / 30 / 24 px on slides; nothing smaller than 22px on a slide.
- **Radius**: `radius-card` (14px) for cards and panels, `radius-control` (10px) for buttons, inputs and badges.
- **Dark sections**: a cover or hero may run on the dark theme (`#111317`) with a faint dot grid, as on the Tingly Box homepage.

## Usage

| Need | Use |
|---|---|
| Slide title | `slide-title` in `ink` |
| Product and topic above the title | `eyebrow` in `brand`, capitals |
| Paragraph under the title | `lead` in `ink-muted`, at most three lines |
| The number a slide is about | `stat` inside a `Card` |
| Footer and page number | `body` in `ink-faint`, pinned 64px from the bottom |
| Primary action | `Button` with `variant: "primary"`; one per view |

Text contrast: `ink`, `ink-muted`, `ink-faint`, `brand`, `positive`, `negative` and `warning` all hold 4.5:1 on `paper` and `surface` in both themes.

<!-- consuming-this-system:begin -->
## Consuming this system (generated — do not edit)

Written from `tokens.json` each time it changes: change a value there, never here or in `tokens.css`.

### Use it

- A page: `<link rel="stylesheet" href="tokens.css">` (the path from the page to this system's `tokens.css`). It defines every colour, spacing, radius and shadow as a custom property, `--font-<key>` for each family, a class per text style, and the `@font-face` rules.
- A canvas artboard or a slide cannot link a stylesheet (its frame loads only inline styles and Google Fonts), so there write each value from the tables below; to keep the variables, copy the `:root { … }` blocks of `tokens.css` into the artboard's `<helmet><style>`. A canvas or deck that installed this system also has its `tokens.json` at `ds/<folder>/tokens.json`.
- Where `var()` cannot go (a chart's options, an SVG attribute such as `fill` which not every browser reads `var()` in), write the value from the tables below.
- Themes: `light`, `dark`. `light` is the default (`:root`). For another theme put `data-theme="<id>"` on the element that wraps the page; the variables change, and the tables give each theme's value for the places a variable cannot go.

### Colours

Write a colour as `color: var(--paper, #f7f7f4)`: the variable first, the `light` value as the fallback, both from the same row.

| token | CSS | Light | Dark | use |
| --- | --- | --- | --- | --- |
| `paper` | `var(--paper, #f7f7f4)` | `#f7f7f4` | `#111317` | The page and slide background. |
| `surface` | `var(--surface, #ffffff)` | `#ffffff` | `#1a1d23` | Cards, tables, panels and code blocks. |
| `line` | `var(--line, #e5e5e0)` | `#e5e5e0` | `#2b2f37` | Hairlines: card borders, table rules, dividers. |
| `ink` | `var(--ink, #16181d)` | `#16181d` | `#eceef2` | Titles and body text, on paper and surface. |
| `ink-muted` | `var(--ink-muted, #4a4f5a)` | `#4a4f5a` | `#b3b8c3` | Secondary text and captions, on paper and surface. |
| `ink-faint` | `var(--ink-faint, #696e79)` | `#696e79` | `#8b919d` | Footers, axis labels and timestamps, on paper and surface. |
| `brand` | `var(--brand, #2563eb)` | `#2563eb` | `#6d9bff` | Primary actions, links and the one highlighted series, on paper and surface. |
| `brand-soft` | `var(--brand-soft, #e9effd)` | `#e9effd` | `#1b2540` | Selected rows, chips and the tint behind brand text. |
| `positive` | `var(--positive, #15803d)` | `#15803d` | `#4ade80` | Healthy, connected and on-target states, on paper and surface. |
| `negative` | `var(--negative, #b91c1c)` | `#b91c1c` | `#f87171` | Errors and destructive actions, on paper and surface. |
| `warning` | `var(--warning, #b45309)` | `#b45309` | `#f59e0b` | Degraded states and things to watch, on paper and surface. |
| `accent` | `var(--accent, #2563eb)` | `#2563eb` | `#6d9bff` | The accent other surfaces pick up; an alias of brand. |

### Type

Set text in one of the styles below: give the element the class (a style `body` is `class="body"`), or write the values from the Styles table. No literal sizes of your own.

Families:

| family | CSS variable | stack |
| --- | --- | --- |
| `display` | `var(--font-display)` | `'Instrument Serif', Georgia, serif` |
| `sans` | `var(--font-sans)` | `'Inter', Arial, sans-serif` |

Styles:

| style | CSS | family | size | line height | weight | italic | letter spacing | use |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cover-title` | `.cover-title` | `display` | `136px` | 1 | 400 |  | -2px | A deck's cover title, once. |
| `slide-title` | `.slide-title` | `display` | `76px` | 1.05 | 400 |  | -1px | Every content slide's title, at the top margin; a full sentence that states the point. |
| `stat` | `.stat` | `display` | `72px` | 1.1 | 400 |  | -1px | The one number a slide or card is about. |
| `lead` | `.lead` | `sans` | `30px` | 1.55 | 400 |  |  | The paragraph under a slide title; ink-muted, at most three lines. |
| `eyebrow` | `.eyebrow` | `sans` | `22px` | 1.4 | 600 |  | 3px | Product and topic above a title, in capitals, in brand. |
| `body` | `.body` | `sans` | `24px` | 1.5 | 400 |  |  | Captions, table text and footers; the smallest size on a slide. |

Faces:

- `Instrument Serif`: Google Fonts, loaded by `tokens.css` (https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap)
- `Inter`: Google Fonts, loaded by `tokens.css` (https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap)

### Spacing

| token | CSS | value | use |
| --- | --- | --- | --- |
| `space-card-gap` | `var(--space-card-gap)` | `10px` | Between a number and its caption inside a card. |
| `space-stack` | `var(--space-stack)` | `28px` | Between eyebrow, title and lead. |
| `space-card-x` | `var(--space-card-x)` | `32px` | A card's side padding (28px top and bottom). |
| `space-margin` | `var(--space-margin)` | `128px` | The slide margin; 160px at the bottom where a footer sits. |

### Radius

| token | CSS | value | use |
| --- | --- | --- | --- |
| `radius-card` | `var(--radius-card)` | `14px` | Cards, panels, code blocks and charts. |
| `radius-control` | `var(--radius-control)` | `10px` | Buttons, inputs and badges. |

### Shadow

| token | CSS | value (light) | use |
| --- | --- | --- | --- |
| `raised` | `var(--raised)` | `0 1px 2px rgba(16, 18, 24, 0.04), 0 12px 32px -12px rgba(16, 18, 24, 0.14)` | Menus, popovers and the one featured card on a page; other cards stay flat with a hairline. |

`tokens.css` is the stylesheet; it never needs editing.

<!-- consuming-this-system:end -->
