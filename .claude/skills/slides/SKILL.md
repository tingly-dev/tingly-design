---
name: slides
description: Read before creating or editing a slide deck under projects/ (deck.json and slides/<id>.html) — the file layout, the closed HTML/CSS subset a slide is written in, and the rules that keep slides editable in the deck editor.
---

# Slide decks

A deck is a folder under `projects/<name>/`, laid out as the original Slides type lays out `project/`:

- `deck.json` — the deck's title, slide order, sections and typefaces.
- `slides/<id>.html` — one file per slide: exactly one `<section id="<id>" …>` on a fixed 1920×1080 canvas.
- `assets/…` — images and fonts the slides use (uploaded from the editor; served beside the deck).

The editor (`pnpm dev`, http://localhost:5173/?p=<name>) watches these files: anything you write shows up within a second and is recorded in the deck's journal. People edit the same files from the editor, so **read a file right before you change it** and change only what was asked. `projects/q3-review` is a full example (a board deck; the ARR slide carries a live `<x-embed>` chart).

## deck.json

```json
{
  "v": 4,
  "title": "Q3 review",
  "cover": "cover",
  "order": ["cover", "numbers", "plan"],
  "sections": { "s1": { "description": "Where we are", "start": "cover" }, "s2": { "description": "What we do next", "start": "plan" } },
  "faces": { "source-serif-4": { "family": "Source Serif 4", "href": "https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@300..700&display=swap" } },
  "designSystems": []
}
```

- `order`: slide ids (`[A-Za-z0-9_-]{1,64}`) in deck order. A slide file `order` leaves out shows last.
- `sections`: the outline — any key → one sentence and the id of its first slide. A section runs until the next one starts.
- `faces`: at most 4 typefaces, keyed by the family lowercased with spaces as `-`: `family` plus `href` (a `https://fonts.googleapis.com/css2?…` link) or `src` (a font file path such as `assets/Brand.woff2`). Basic and generic faces need no entry.
- Keep every key you are not changing. To add a slide: write its file and put its id in `order`. To remove one: take its id out of `order` (and out of `cover` / a section `start`) and ask the person to delete the slide in the editor.

## A slide file

```html
<section id="plan" data-transition="fade" style="background:#fbfbf8;color:#1a1a1a;font-family:'Source Serif 4', Georgia, serif;padding:128px 128px 160px;display:flex;flex-direction:column;justify-content:space-between;gap:48px">
<h2 style="font-size:72px;font-weight:400;line-height:1.1">Changes</h2>
<div style="display:flex;gap:32px">
<div style="flex:1;display:flex;flex-direction:column;gap:12px;background:#ffffff;padding:40px;border:1px solid #e3e6e4;border-radius:16px">
<h3 style="font-size:32px;font-weight:600">One path</h3>
<p style="font-size:28px">Everything ships from one branch.</p>
</div>
<img src="assets/hq-1a2b3c4d.jpg" alt="HQ" style="width:480px;height:360px;object-fit:cover;border-radius:16px">
</div>
<p style="position:absolute;left:128px;bottom:64px;width:800px;font-size:24px;color:#6a7179">Source: poll</p>
<aside>Speaker notes: plain text, read by the presenter.</aside>
</section>
```

- Nothing before or after the `<section>`: no `<html>`, `<head>`, `<link>`, `<style>`, `<script>`. The file name is the slide id and the section's `id` equals it.
- On the section: always a `background`; the text defaults (`font-family`, `color`); the layout (`display:flex; flex-direction:column` or `display:grid`, `padding:128px` = the margins, 1664×824 inside, `gap`, `align-items`, `justify-content`).
- Children flow in the section; `position:absolute` pins one to the slide (or to a `position:relative` `<div>`) with `left`/`top`/`right`/`bottom`/`width`/`height`. Give pinned text a `width`.
- **Paint order**: children paint in source order, and all flow content paints as one layer where the first flow child sits. A full-bleed backdrop goes first; a pinned card after the text sits on top of it.
- `hidden` on the section skips it when presenting. `data-transition="fade|push|magic"` is how it leaves. `data-build-in="fade|rise|drop|left|right|scale|pop [order N] [auto]"` on a pinned child makes it appear on a click (or with the previous step, `auto`).
- `<aside>`: speaker notes, plain text, the section's last child, ≤ 4000 characters.

## The subset

Every style is inline. Only these properties exist (lengths in px, colours as hex or rgb; no `em`, `rem`, `vw`, `vh`, `var()`, `currentColor`):

`position` (absolute | relative), `left top right bottom width height min-width min-height max-width max-height`, `display` (flex | grid | none; **no display = a column**), `flex-direction flex-wrap gap align-items justify-content justify-items align-self justify-self flex flex-grow flex-shrink flex-basis`, `grid-template-columns grid-template-rows` (px, fr, auto, repeat; no minmax or areas), `grid-column grid-row` (span N), `aspect-ratio`, `padding`, `overflow`, `font-family font-size font-weight font-style font line-height letter-spacing text-align text-transform white-space text-decoration font-variant-numeric -webkit-text-stroke`, `color`, `background` (a colour or one gradient), `background-clip:text` with `-webkit-text-fill-color:transparent`, `border border-top border-right border-bottom border-left border-radius box-shadow text-shadow opacity`, `transform` (2D translate, rotate, scale, skew), `filter backdrop-filter mix-blend-mode`, `object-fit` (img).

Never: `margin` (use `padding` or `gap`), `z-index` (order the children), classes, `<style>`, scripts or `on…=` handlers outside `<x-embed>`.

Elements:

| element | use |
|---|---|
| `h1 h2 h3 p` | text; set `font-size` (≥ 24px everywhere); defaults 96/64/44/32px |
| `ul` / `ol` of plain `li` | parallel lines, one level |
| `b i u a span br` | inline; a `span` takes `color` only, never a size or font |
| `div` | containers: flex row/column or grid, ≤ 15 deep; invisible unless painted (a painted empty `div` is a rectangle) |
| `img src alt style` | `src` is a file of the deck (`assets/…`); `object-fit:cover` for photos, `contain` for screenshots |
| `table` of `tr` / `th` / `td` | rows straight in the table; column widths as `width:N%` on the first row's cells |
| `svg aria-label` | a drawing ≤ 52 KB; no script, no URLs; labels as `<p>`s over it |
| `hr` | a line |
| `x-shape kind style` | `rect rounded ellipse diamond arrow-right arrow-left arrow-up arrow-down line`: `background` fills it, `border` strokes it |
| `x-icon name style` | `Activity Book Chart Chat Check CheckCircle Clock Cloud Code Database Globe GraduationCap Home Key Lightbulb Lightning Link Lock PaperPlane Play Search Settings Star ThumbsUp Tool Trust Users Verified Warning Wrench`; `color`, `width`, `height` |
| `x-connector x1 y1 x2 y2 head route style` | an arrow in slide coordinates: `head="end|both|none"`, `route="straight|hv|vh|elbow"`, `style="color;border-width;border-style"` |
| `x-embed style` | a live mini page (HTML/CSS/JS, ≤ 16 KB, ≤ 8 per slide), a **direct, pinned** child of the section; runs sandboxed with no network; the deck's fonts don't reach it |

At most 200 elements on a slide.

## Craft

- One idea per slide; turn lists into tables, card rows, big numbers or quotes.
- One type scale of four or five sizes; 1–3 typefaces; nothing under 24px.
- Vertical budget: 824px inside the margins. A heading ≈ size × lines × 1.1; a table row ≈ 2.1 × font-size. Too much? Split the slide.
- The heading sits at the top margin on every content slide, never centred with the body, so it doesn't hop between slides.
- A footer (page number, source) is one pinned 24px row at `bottom:64px`, and that slide's padding becomes `128px 128px 160px`.

## Keeping it editable

- Change only what was asked; keep everything else byte for byte (the editor writes back minimal text patches, and so should you).
- The editor checks each slide against the subset and shows what's outside it; keep your slides clean.
- Ids such as `dc12` in a request are handles the editor numbered depth-first over the slide's elements; they are never in the files.
