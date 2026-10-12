# Tingly Design System

The shared look of the Tingly projects: [Tingly Box](https://github.com/tingly-dev/tingly-box), the open-source AI gateway that connects any agent to any model, and Tingly Design, the local design workspace this system lives in. The values come from the Tingly Box homepage and web UI; the sample deck (`projects/tingly-intro`), the console mockups (`projects/box-console`) and the usage dashboard (`projects/box-usage`) are built with it.

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
