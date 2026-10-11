# What the Slides editor does (read from its bundle, 2026-10-11)

Sources: grep of `type/app.pretty.js` (line numbers below are in that file) and `type/reference/view-state.md`.

## 1. Editor UI

- **Insert tools:**
  - "Add a text box — click, or drag onto the slide"
  - "Insert an image or video…"
  - "Insert a table — click, or drag onto the slide"
  - **Shapes** — "Insert a shape, line, or connector on the selected slide"
  - "Embed a YouTube video"
- **Present:** "Present full screen", "Present from the current slide" and "Present with speaker notes".
- **Download:**
  - "Download PowerPoint"
  - "Download as PDF"
  - "Export notes"
  - Google Slides ("Sending to Google Slides…")
- **Save status:** "Saved automatically" / "Unsaved edits" / "Saving…".
- **View toggle:** "Editor mode" (`edit`) vs "Canvas" (`grid`, slides laid out by section). Zoom uses ⌘+, ⌘− and ⌘0.
- **Slide strip:**
  - "Hide slide thumbnails" and "Resize slide thumbnails"
  - "Add slide", "Add a slide here"
  - "Add a section here", "Remove section"
  - "Unskip slide" — a skipped slide is a `<section hidden>`
- **Properties panel (dockable):**
  - Layout, Sizing, Spacing, Padding/Margin, Text style, Appearance, Border
  - Effects: drop and inner shadow, blur
  - Fill: solid, or linear/radial gradient with stops, plus an eyedropper ("Pick color from screen")
  - Table: header row, row/column span
  - Connector route: straight or elbow
  - Transition, Advanced
- **Speaker-notes pane:** resizable, labelled "Speaker notes. Never shown on the slide."
- **Image crop:** handles on the image.
- **Context menu (`kv`):**
  - Cut / Copy / Paste / Duplicate
  - Bring to front `]`, Send to back `[`
  - Group ⌘G, Ungroup ⇧⌘G
  - Delete, Select all ⌘A
- **Undo / redo:** ⌘Z and ⇧⌘Z.
- **Other keys:** arrows, Home/End, PageUp/PageDown, Esc, Enter, F6, F10. In present mode, F toggles full screen.

## 2. Rendering

- **No iframe per slide.** Each slide is in-page React DOM. `UU` renders a 1920×1080 div (`o$=1920, M1=1080`) scaled with `transform: scale(width/1920)` and the CSS variable `--slide-scale`.
- **Positioned elements** each render as a `div[data-frame-id]` (`qe0`). Child nodes go through `C_`, which switches on `kind`.
- **Saved HTML is parsed into a typed model.** Node kinds are text, img, icon, shape, table, html, spacer, stack, grid and overlay.
  - Allowed tags: section, h1–h3, p, ul/ol/li, div, img, svg, x-embed, table/tr/th/td, x-shape, x-connector, x-icon, hr, aside, b/i/u/a/span/br.
  - An unknown tag, or `<div>`s nested more than 15 deep, makes the slide `slideHeld` (read-only).
- **`x-embed`** (`Px$` → `yv`):
  - An iframe with `sandbox="allow-scripts"`, its `srcdoc` built by `j_()`.
  - A CSP meta: `default-src 'none'; connect-src 'none'; frame-src 'none'; img-src data: blob:`.
  - Locked down with `inert`, `tabIndex -1`, `pointer-events:none` and `referrerPolicy no-referrer`.
  - Disabled if it navigates away or grabs focus.
  - A tiny runtime inside it posts `appifact-embed:ready` and `appifact-embed:save` (state ≤16 KB).
- **`x-shape`** (`wx$`): rect, rounded, ellipse and line are CSS divs (`data-shape`; ellipse uses `border-radius:50%`). The other kinds are SVG paths.
- **`x-connector`** (`Rx$`): an SVG drawn from x1/y1/x2/y2. It supports `head=end|both|none` and `route=straight|elbow|hv|vh`.
- **`x-icon`** (`_x$`): `<svg><text font-family="mc-anthropicons">`, using the icon font in `fonts/`.
- **Inline SVG** is checked by `PS$`. It rejects script, foreignObject, URLs and SMIL.

## 3. Editing model: unlike Design

- **Whole-slide re-serialization, not minimal patches.**
  - Edits change an immutable model.
  - The serializer class `En` (`oE(deck, slide)`) re-emits the whole `<section>`, normalized: inline styles, `id`, `data-build-in/out`, `data-transition`, `data-section` and the `<aside>` notes.
  - A WeakMap cache keyed by slide object (`mJ$`, ~149460) means only changed slides are rewritten. Only `project/slides/<id>.html` (`g8`) and `project/deck.json` (`v6`) are published.
- **The parser is also the validator.** It produces warnings and rejections with fix hints, e.g. "`<iframe>` → use `<x-embed>`" or "x-shape background is one flat COLOR".
- **Undo:** a command stack `wl0(200)` (exec/undo/redo, canDo/canUndo) with per-slide revisions (`slideRev`). It can refuse: "Someone else has reordered… Press undo again to go ahead anyway".

## 4. Saving

- `T2$` calls `window.claude.self.publish(files, { ifMatch: {path: sha256|null} })` (~165939), tracking `shas` and `changed`. The file list comes from `_files.json` (~164335).
- **Conflicts:**
  - "Someone saved a newer version first — loading it now"
  - "Keep newer version"
  - "Restore unsaved changes" (a local stash)
- **No in-page AI editor.** There is no fast_edit, happy-dom or jQuery. "Ask Claude to fix" only hands a prompt to the chat ("Added to your message to Claude…").

## 5. Present mode

- **Transitions** `wE = fade | push | magic`: None, Fade, Push and "Magic move". Magic move matches positioned frames by id across the two slides.
- **Builds:** effects `OT = fade | rise | drop | left | right | scale | pop`, timed "On click", "With slide" or "Delay". Builds apply to positioned children only.
- **Speaker notes:** a separate window titled "Speaker notes · i / n", driven by postMessage (`exit`, `notes-end`). Notes can be edited there.
- **Full screen:** `requestFullscreen({navigationUI:"hide"})`.

## 6. Export (all client-side)

- **PPTX:** bundled PptxGenJS + JSZip.
  - Native text, shapes, tables and notes (`addText` / `addShape` / `addTable` / `addNotes`, ~101199–102391), saved as "Presentation.pptx".
  - Fallback: one image per slide (~110381).
- **PDF:** each slide goes SVG `<foreignObject>` → Image → JPEG (or zlib), then into a hand-written PDF writer (~103920, `/DCTDecode`). A print stylesheet `@page{size:1920px 1080px}` also exists.
- **Google Slides:** renders the PPTX, then uploads it via the Google Drive MCP (`create_file` / `gdrive_upload`). Behind the flag `slides_send_to_google_slides`.
- **Standalone player:** `nQ$` builds per-slide steps and embeds for an exported player (~110560).

## 7. View context sent to the model (`view-state.md`)

- **Shape:** `<artifact-view-context>` holds `{mode: edit|grid|present, deck, slideId, slideTitle, slideIndex, slideCount, dirty, edits, selected[≤20], selection[≤5 {id, kind, label}]}`.
  - Optional: `slideHeld`, `slideHeldWhy`.
  - Grid mode adds `sections`, `slideSections`, `selectedCount` and `editingSection`.
- **Ids:** an element's own id, or a minted `e<n>-<hash>`.
  - Flow children are addressed as `/index`; a table cell adds `row/col`.
  - Pattern: `^[A-Za-z0-9_-]{1,64}(\/\d{1,2}){0,4}$`.
- **`kind`** is one of text, img, icon, shape, table, html, spacer, stack, grid, overlay, slide, section or cell.
- **Rule for the model:** when `dirty` is set and the target is nested, confirm before editing.
