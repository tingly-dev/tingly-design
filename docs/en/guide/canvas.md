<p align="right"><b>English</b> · <a href="../../zh/guide/canvas.md">简体中文</a></p>

# Canvas

The top left holds the page menu and the tools; the top right holds play, the panel toggle, zoom and the sync log; the bottom bar is the prompt for AI (paste, drop or pick images, PDFs and text files into it; they are kept in the project's `uploads/`; the request you sent stays above the box with each step the AI is taking, how long it has run and which files it changed, and you can stop it, undo the whole run, or put a failed request back in the box; this works the same in every kind); the right panel folds away with `⌘\`.

- **Tools**: select V, hand H, text T, artboard A, sticky note N, pen P, rectangle R, ellipse O, line L, arrow ⇧L. Notes and shapes live in `canvas.json`, with size (s/m/l/xl/xxl), colour, fill, rotation and flips.
- **Artboards**: rename, run full window or export PNG from the name strip; resize from the corner; several pages, each with its own artboards.
- **Right panel**: the layer tree, named by role (row, column, grid, text, image…, with loops marked); properties (text style, hug/fixed/fill sizing, direction and gap, fill, stroke, radius, shadow, opacity); code (the element's own declarations are editable, inherited values listed read-only); Tweaks (edits the `data-props` defaults).
- **Direct manipulation**: drag a selected element to reorder it among its siblings; drag it out of its parent to position it freely (the parent becomes `position:relative` and keeps its height); resize from the handles; double-click to retype; right-click for the context menu.
- **Play mode**: artboards run their own logic, and links between artboards navigate.
- **Import**: the import button in the toolbar, or drop files on the canvas, or paste SVG. A page (with its folder) or an SVG becomes new artboards to the right of what the page already has; pictures land where you drop them. Originals are kept in `uploads/`.

<details>
<summary><b>Shortcuts</b></summary>

| Keys | Action |
|---|---|
| Esc | Close a menu → leave play mode → back to the select tool → clear the selection |
| ⇧↵ / ↵ | Select the parent / the first child |
| ⌫ | Delete |
| ⌘C ⌘X ⌘V ⌘D | Copy, cut, paste, duplicate |
| ⌘G / ⌘⇧G / ⇧A | Group / ungroup / wrap in a flex container |
| [ ] | Bring to front / send to back |
| ⇧H ⇧V | Flip horizontally / vertically |
| ⌘Z ⌘⇧Z | Undo / redo |
| ⌘= ⌘- ⌘0 ⇧1 ⇧2 | Zoom in, zoom out, 100%, fit all, zoom to selection |

</details>

Format reference: [`.claude/skills/dc-canvas/SKILL.md`](../../../.claude/skills/dc-canvas/SKILL.md)

---

Back to the [README](../../../README.md)
