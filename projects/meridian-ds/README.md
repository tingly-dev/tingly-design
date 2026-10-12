# Meridian Design System

Meridian is a revenue analytics product for finance and RevOps teams. This system holds what its product screens, board decks and dashboards share: two themes, two typefaces, a six-step type scale, one accent and a small set of components. The values are taken from the product UI (`projects/product-ui`) and the Q3 board deck (`projects/q3-review`). Meridian is a fictional company; the system is a sample.

## Voice

- Lead with the result, then the reason: "ARR grew 7.8% in the quarter", not "ARR update".
- Numbers are exact and carry their unit and period: "$52.4M ending ARR", "118% NRR, trailing twelve months".
- Plain words, short sentences, no exclamation marks. Say what changed and what we will do about it.

## Visual foundations

- **Paper, not white**: pages and slides sit on `paper`; cards and tables on `surface` with a 1px `line` border. Cards stay flat; `raised` is only for menus and popovers.
- **One accent**: `brand` marks the primary action and the one series a chart is about. Everything else in a chart is neutral gray.
- **Status colours mean status**: `positive` for on or above target, `negative` for a miss, `warning` for a risk. Never decoration.
- **Two typefaces**: Inter Tight (`display`) for titles, Inter (`sans`) for everything else. Titles are full sentences in sentence case.
- **Type scale**: 128 / 64 / 30 / 24 px on slides; nothing smaller than 24px on a slide.
- **Radius**: `radius-card` (12px) for cards and panels, `radius-control` (8px) for buttons, inputs and badges.

## Usage

| Need | Use |
|---|---|
| Slide title | `slide-title` in `ink` |
| Topic above the title | `eyebrow` in `brand`, capitals |
| Paragraph under the title | `lead` in `ink-muted`, at most three lines |
| The number a slide is about | `stat` inside a `Card` |
| Footer and page number | `body` in `ink-faint`, pinned 64px from the bottom |
| Primary action | `Button` with `variant: "primary"`; one per view |

Text contrast: `ink`, `ink-muted`, `ink-faint`, `brand`, `positive`, `negative` and `warning` all hold 4.5:1 on `paper` and `surface` in both themes.
