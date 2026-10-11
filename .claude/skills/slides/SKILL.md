---
name: slides
description: Read before creating or editing a slide deck under projects/ (deck.json and slides/<id>.html) — the deck index, the slide subset of HTML/CSS, and the rules that keep slides editable in the editor.
---

# Slide decks

A deck is a folder under `projects/<name>/`:

- `deck.json` — the index: title, slide order, sections, fonts.
- `slides/<id>.html` — one file per slide: exactly one `<section id="<id>">` and nothing around it.
- `assets/…` — images the slides use (the editor's image button uploads here).

The editor (`pnpm dev`, http://localhost:5173/?p=<name>) watches these files. Anything you write shows up in every open editor within a second and is recorded in the journal as an outside edit. People edit the same files from the editor, so **read a file right before you change it** and change only what was asked.

The format follows the Slides type of claude.ai, so decks move between the two (there the same files sit under `project/`).

## deck.json

```json
{
  "v": 4,
  "title": "Q3 review",
  "cover": "cover",
  "order": ["cover", "plan", "numbers"],
  "sections": {
    "s1": { "description": "Where we are", "start": "cover" },
    "s2": { "description": "The numbers", "start": "numbers" }
  },
  "faces": {
    "source-serif-4": { "family": "Source Serif 4", "href": "https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;700&display=swap" }
  },
  "designSystems": []
}
```

- `order` — slide ids in show order. A slide file that `order` leaves out is shown last.
- `sections` — the outline: any key → one sentence and the id of its first slide (`start`); a section runs to the next one's start. An empty section has `before` (the slide it sits before) instead of `start`.
- `cover` — the slide used as the deck's thumbnail.
- `faces` — one entry per typeface the slides name (at most 4), keyed by the family lower-cased with spaces as `-`: a Google Fonts css2 `href`, or `src` = a font file inside the deck. Generic families need no entry.
- Ids match `[A-Za-z0-9_-]{1,64}`. Keep every key you are not changing.

Adding a slide = write `slides/<id>.html` and put the id in `order`. Removing = delete the file and take the id out of `order` (and move a `cover` or section `start` that named it to the next slide). Reordering or renaming the deck = `deck.json` only.

## A slide

```html
<section id="plan" data-transition="fade" style="background:#fbfbf8;color:#1a1a1a;font-family:'Source Serif 4', Georgia, serif;padding:128px 128px 160px;display:flex;flex-direction:column;gap:48px">
<h2 style="font-size:72px;line-height:1.1">What changes</h2>
<div style="display:flex;gap:32px">
<div style="flex:1;display:flex;flex-direction:column;gap:12px;background:#ffffff;padding:40px;border:1px solid #e3e6e4;border-radius:16px">
<h3 style="font-size:36px">One path</h3>
<p style="font-size:28px">Every request goes through the same queue.</p>
</div>
<img src="assets/hq.jpg" alt="Head office" style="width:480px;height:360px;object-fit:cover;border-radius:16px">
</div>
<p style="position:absolute;left:128px;bottom:64px;width:900px;font-size:24px;color:#6a7179">Source: team survey</p>
<aside>Speaker notes: plain text, the section's last child.</aside>
</section>
```

The canvas is a fixed 1920×1080 px; `padding:128px` on the section are the margins (1664×824 inside). Nothing shrinks to fit: budget the height (a heading ≈ size × lines × 1.1, a table row ≈ 2.1 × font-size), and split a slide rather than cram it.

### The subset

Every style is inline (`style="…"`), with px lengths and hex/rgb colours. No classes, `<style>`, `<script>`, `margin`, `z-index`, `em`/`rem`, `%` font sizes or `var()`.

- **Section** — always a `background`; text defaults (`font-family`, `color`); layout: `display:flex; flex-direction:column` or `display:grid`, `padding`, `gap`, `align-items`, `justify-content`. A `<div>` without `display` is a column.
- **Pinning** — `position:absolute` takes a child out of the flow and pins it to the slide (or to a `position:relative` div): `left`/`top`/`right`/`bottom`/`width`/`height`. Give pinned text a `width`. Later children paint over earlier ones, so a full-bleed backdrop comes first.
- **Text** — `<h1>` `<h2>` `<h3>` `<p>` (defaults 96/64/44/32px), `<ul>`/`<ol>` of plain `<li>`, `<br>`; inline only `<b>` `<i>` `<u>` `<a href>` `<span style="color:…">`. Nothing under 24px. A pill is a `<p>` with `background`, `padding`, `border-radius`.
- **Images** — `<img src alt style="width;height;object-fit:cover|contain">`; `src` is a path inside the deck (`assets/x.png`). An `<img>` with no `src` is a sized placeholder.
- **Tables** — `<table>` of `<tr>` with `<th>` (first row) / `<td>`, plain text cells; widths as `width:N%` on the first row's cells; set `font-size` on the table.
- **Graphics** — `<svg aria-label="…">` (no script, no `<text>` — put labels as `<p>` over it), `<hr>`.
- **Shapes** — `<x-shape kind="rect|rounded|ellipse|diamond|arrow-right|arrow-left|arrow-up|arrow-down|line" style="width;height;background;border">`.
- **Icons** — `<x-icon name="…" style="width;height;color">`, name one of Activity Book Chart Chat Check CheckCircle Clock Cloud Code Database Globe GraduationCap Home Key Lightbulb Lightning Link Lock PaperPlane Play Search Settings Star ThumbsUp Tool Trust Users Verified Warning Wrench.
- **Connectors** — `<x-connector x1 y1 x2 y2 head="end|both|none" route="straight|hv|vh|elbow" style="color;border-width;border-style">` in slide coordinates (px or %).
- **Live embeds** — `<x-embed style="position:absolute;left;top;width;height">…a small page…</x-embed>`: a direct child of the section, pinned; runs sandboxed with no network (≤16 KB, ≤8 per slide). The editor shows it live on the stage and while presenting, as a placeholder in thumbnails.

### Motion (Present)

- `data-transition="fade|push|magic"` on the section: how the slide leaves for the next one.
- `data-build-in="fade|rise|drop|left|right|scale|pop [order] [auto]"` on pinned children: they come in one click at a time, in `order` (else source order); `auto` comes in with the step before.
- `hidden` on the section skips the slide when presenting (the editor still shows it, dimmed).

## Rules that keep a slide editable

- Exactly one `<section>` per file, its `id` equal to the file name. The editor parses the whole file as the slide.
- Inline styles only, one declaration per property; the editor rewrites single declarations in place and leaves the rest of the file byte-for-byte as written.
- Literal text in text blocks: a person can double-click and retype a `<p>` whose content is plain text; inline marks inside make it read-only on the stage (still editable here).
- Keep `<aside>` the section's last child; the editor's notes pane reads and writes it.
- Don't put handle-like ids (`dc12`) into files: those are the editor's temporary handles, numbered depth-first over the whole file.

## Design

You are a presentation designer, not a web designer. One idea per slide; a statement beats bullets; turn lists into tables, card rows, big numbers or quotes. One dark, one light and one or two accent colours, set once per deck; four or five font sizes reused everywhere; headings at the same height on every content slide. A footer (page number, source) is one pinned 24px row at `bottom:64px` on a slide with `padding:128px 128px 160px`. Never invent statistics or quotes: leave `[__]` placeholders and say so.
