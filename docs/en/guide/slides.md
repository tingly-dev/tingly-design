<p align="right"><b>English</b> · <a href="../../zh/guide/slides.md">简体中文</a></p>

# Slides

Choose "幻灯片" (slides) when creating a project. The sample [`?p=tingly-intro`](http://localhost:5173/?p=tingly-intro) is "Meet Tingly", an introduction to Tingly Box and Tingly Design; the gateway slide carries a live `<x-embed>` diagram.

Choose a size below the title when creating a deck: the same categories, concrete dimensions and Custom fields as Canvas and Motion. The default is 1920×1080; portrait, square and other ratios work through editing, presentation and export. The size is saved as `size: [width, height]` in `deck.json`; existing decks keep the default.

![Slide editor: thumbnails and sections on the left, the stage and speaker notes in the middle, layers and properties on the right](../../images/slides.png)

```
projects/<name>/
  deck.json            title, slide order, sections, typefaces
  slides/<id>.html     one file per slide: exactly one <section id="<id>">, deck size (default 1920×1080), a closed HTML/CSS subset
  assets/              uploaded images and fonts
```

- **Thumbnail strip**: grouped by section (double-click a section to edit its description); drag to reorder; right-click to add, duplicate, skip, start a section or delete. Live embeds stay still in thumbnails.
- **Stage**: the current slide, scaled to fit. Selection, double-click to retype, drag to reorder or pin, and the layers / properties / code panel (the layers with the same hide and lock on every row) all work as on the canvas, through the same minimal write-back. Speaker notes sit below the stage (written to `<aside>`).
- **Text boxes**: a `<div data-text>` holding paragraphs and lists is one box: a click selects the whole box (move, resize and style it once), a double-click types in the paragraph under the pointer, and `data-text="N"` sets the lists' indent in px.
- **Insert**: text, images (uploaded to `assets/`), tables, shapes (rectangle, rounded, ellipse, diamond, four arrows, line), connectors and icons.
- **Format check**: every slide is checked against the subset of the original `format.md` (unknown tags, `margin`, `z-index`, `em`, `var()`, an unpinned `<x-embed>`…). Counts show above the stage and on thumbnails, and clicking an issue selects the element. If a fast AI edit introduces a new violation, it is undone and the model is told why and asked again.
- **Present**: F5 from the start, ⇧F5 from the current slide; → / Space / click plays the slide's builds (`data-build-in`) and then advances; `fade` and `push` transitions (`magic` falls back to fade); N toggles speaker notes; F for full screen; Esc to leave.
- **Import / Export** (top right, next to Present): a PDF in one click, one page per slide (made by the Chrome on the machine running the server; with none, it opens the print dialog and you choose Save as PDF), a single HTML file (images inlined, embeds sandboxed and running, arrow keys to page), a Markdown file (the deck written as a document: the title, section and slide titles as headings, text, lists and tables, pictures by their path and alt text, speaker notes as quotes; shapes and embeds left out), or the speaker notes as text. The same menu saves this slide, or every slide, as PNG pictures at the slide's size (an embed comes out empty in a picture), and brings in pictures and SVGs. At the end of the same menu, “Whole project (.zip)” saves the project itself: every file, its change log and the design systems it installed, beside it; “Project files only (.zip)” leaves those two out. “Import a project package (.zip)…” in the home page's New menu opens it again (a name already taken gets `-2`), and so does a project folder you zipped yourself.
- **Importing pictures**: drop or paste pictures or SVGs into the editor and they go onto the open slide (kept in `uploads/`, like Insert image).
- **Built-in effects**: an empty embed with `data-fx` (`<x-embed data-fx="aurora" …>`) draws a moving WebGL background or light, the same sixteen as in motion pieces (see the motion guide). It stands still while you edit and in the PDF, and moves while presenting and in the downloaded HTML.
- **Importing from a project**: the Import / Export menu's "From a project…" lists the artboards of your canvases. The one you pick is copied into this deck (`uploads/<canvas>-<board>/`) and goes onto the open slide. An artboard that moves with time (an effect, marked "Moves") fills the slide behind everything and loops while presenting and in the downloaded HTML; a still one sits in the middle. Select it to set its options (they are written to the embed, the copy stays as it came), open the original, or update it from its canvas: every slide using it changes together.

Rendering follows the original's rules: a `<div>` with no `display` is a flex column; children paint in source order, with all flow content painted as one layer where the first flow child sits (so a full-bleed backdrop written first stays behind the text); `<x-embed>` runs in its own sandboxed page with no network and a different origin.

## PowerPoint (.pptx)

On the home page, choose **New project → Import PowerPoint (.pptx)…**, or drop a PPTX onto the launcher. It becomes a **new slides project**, not an attachment or an addition to the deck you have open. The command line uses the same converter: `tingly-design import talk.pptx`. A name already taken gets a free suffix. The conversion summary identifies changes and warnings; the original PPTX, pictures and JSON report stay under `uploads/`. Failed conversion creates no project.

The importer supports a conservative subset: text (including Chinese), basic character styles, simple placeholder inheritance, solid backgrounds, rectangles, rounded rectangles, ellipses, lines, PNG/JPEG pictures and speaker notes. Other page sizes are fitted proportionally into 1920×1080 with a reported adjustment. Explicit unmerged tables, paragraph line spacing and cropped PNG/JPEG pictures are also imported as editable content. Theme-styled/merged tables, charts, groups, bullets and many effects are not supported yet: the whole import is refused with a location and reason, rather than silently dropping them. Old `.ppt`, macros and encrypted presentations are not supported.

In a slides project's **Import / Export** menu, choose **PowerPoint (.pptx)** to save the whole visible deck. Text, supported shapes and pictures become native PowerPoint objects; speaker notes stay notes. Hidden slides and hidden elements are omitted. Editing continues in the ordinary slide files; export creates a fresh package, not an update of the original PPTX.

Export measures the actual slide layout. It does not promise identical font rendering or fully reflowable original paragraphs, and it does not embed fonts. Unsupported content (including embeds, tables, gradients and complex transforms) is reported with its slide instead of being left blank or silently turned into a screenshot. No partial presentation is downloaded. `tingly-design export talk --as pptx --out ./exports` writes the file into the `exports` directory; MCP export uses the same path. PPTX is whole-deck only, so a single-slide selection is rejected.

Format reference: [`.claude/skills/slides/SKILL.md`](../../../.claude/skills/slides/SKILL.md)

---

Back to the [README](../../../README.md)
