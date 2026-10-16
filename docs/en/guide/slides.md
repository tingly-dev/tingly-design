<p align="right"><b>English</b> · <a href="../../zh/guide/slides.md">简体中文</a></p>

# Slides

Choose "幻灯片" (slides) when creating a project. The sample [`?p=tingly-intro`](http://localhost:5173/?p=tingly-intro) is "Meet Tingly", an introduction to Tingly Box and Tingly Design; the gateway slide carries a live `<x-embed>` diagram.

![Slide editor: thumbnails and sections on the left, the stage and speaker notes in the middle, layers and properties on the right](../../images/slides.png)

```
projects/<name>/
  deck.json            title, slide order, sections, typefaces
  slides/<id>.html     one file per slide: exactly one <section id="<id>">, 1920×1080, a closed HTML/CSS subset
  assets/              uploaded images and fonts
```

- **Thumbnail strip**: grouped by section (double-click a section to edit its description); drag to reorder; right-click to add, duplicate, skip, start a section or delete. Live embeds stay still in thumbnails.
- **Stage**: the current slide, scaled to fit. Selection, double-click to retype, drag to reorder or pin, and the layers / properties / code panel (the layers with the same hide and lock on every row) all work as on the canvas, through the same minimal write-back. Speaker notes sit below the stage (written to `<aside>`).
- **Insert**: text, images (uploaded to `assets/`), tables, shapes (rectangle, rounded, ellipse, diamond, four arrows, line), connectors and icons.
- **Format check**: every slide is checked against the subset of the original `format.md` (unknown tags, `margin`, `z-index`, `em`, `var()`, an unpinned `<x-embed>`…). Counts show above the stage and on thumbnails, and clicking an issue selects the element. If a fast AI edit introduces a new violation, it is undone and the model is told why and asked again.
- **Present**: F5 from the start, ⇧F5 from the current slide; → / Space / click plays the slide's builds (`data-build-in`) and then advances; `fade` and `push` transitions (`magic` falls back to fade); N toggles speaker notes; F for full screen; Esc to leave.
- **Import / Export** (top right, next to Present): a PDF in one click, one page per slide (made by the Chrome on the machine running the server; with none, it opens the print dialog and you choose Save as PDF), a single HTML file (images inlined, embeds sandboxed and running, arrow keys to page), or the speaker notes as text. The same menu saves this slide, or every slide, as PNG pictures at the slide's size (an embed comes out empty in a picture), and brings in pictures and SVGs. At the end of the same menu, “Whole project (.zip)” saves the project itself: every file, its change log and the design systems it installed, beside it; “Project files only (.zip)” leaves those two out. “Import a project (.zip)…” in the home page's New menu opens it again (a name already taken gets `-2`), and so does a project folder you zipped yourself.
- **Importing pictures**: drop or paste pictures or SVGs into the editor and they go onto the open slide (kept in `uploads/`, like Insert image).
- **Importing from a project**: the Import / Export menu's "From a project…" lists the artboards of your canvases. The one you pick is copied into this deck (`uploads/<canvas>-<board>/`) and goes onto the open slide. An artboard that moves with time (an effect, marked "Moves") fills the slide behind everything and loops while presenting and in the downloaded HTML; a still one sits in the middle. Select it to set its options (they are written to the embed, the copy stays as it came), open the original, or update it from its canvas: every slide using it changes together.

Rendering follows the original's rules: a `<div>` with no `display` is a flex column; children paint in source order, with all flow content painted as one layer where the first flow child sits (so a full-bleed backdrop written first stays behind the text); `<x-embed>` runs in its own sandboxed page with no network and a different origin.

Format reference: [`.claude/skills/slides/SKILL.md`](../../../.claude/skills/slides/SKILL.md)

---

Back to the [README](../../../README.md)
