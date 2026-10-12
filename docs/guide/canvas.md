<p align="right"><b>English</b> · <a href="../zh-CN/guide/canvas.md">简体中文</a></p>

# Canvas

The top left holds the page menu and the tools; the top right holds play, the panel toggle, zoom and the sync log; the bottom bar is the prompt for AI; the right panel folds away with `⌘\`.

- **Tools**: select V, hand H, text T, artboard A, sticky note N, pen P, rectangle R, ellipse O, line L, arrow ⇧L. Notes and shapes live in `canvas.json`, with size (s/m/l/xl/xxl), colour, fill, rotation and flips.
- **Artboards**: rename, run full window or export PNG from the name strip; resize from the corner; several pages, each with its own artboards.
- **Right panel**: the layer tree, named by role (row, column, grid, text, image…, with loops marked); properties (text style, hug/fixed/fill sizing, direction and gap, fill, stroke, radius, shadow, opacity); code (the element's own declarations are editable, inherited values listed read-only); Tweaks (edits the `data-props` defaults).
- **Direct manipulation**: drag a selected element to reorder it among its siblings; drag it out of its parent to position it freely (the parent becomes `position:relative` and keeps its height); resize from the handles; double-click to retype; right-click for the context menu.
- **Play mode**: artboards run their own logic, and links between artboards navigate.

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

Format reference: [`.claude/skills/dc-canvas/SKILL.md`](../../.claude/skills/dc-canvas/SKILL.md)

---

Back to the [README](../../README.md)
