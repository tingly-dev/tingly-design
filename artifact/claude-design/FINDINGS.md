# What the original editor does (observed locally, 2026-10-11)

Run through `emulator/serve.mjs`; screenshots in `screenshots/original-editor/`.

## Canvas chrome
- Floating top-left bar: **Page 1 ▾** (pages menu) · tools **Select / Hand / Text / Artboard / Note / Draw / Shapes ▾**.
- Floating top-right bar: **Play** · **Properties** (toggles the right panel) · **zoom % ▾** (zoom menu) · sync state ("All changes synced").
- No left panel. Warm light-grey canvas, no dot grid.
- Artboard name strip above each frame: title (double-click → inline rename), **Open full window** (⤢) and **Export** (⤓) buttons.
- Selecting a frame: blue outline + four corner handles.

## Selection inside an artboard
- Hover: thin blue outline. Click: blue outline with small square handles.
- Escape walks up to the parent; double-click on text edits in place (text selected, same styling).
- Elements inside `<sc-for>` select as a group: every instance outlines at once, and the panel says they're code-driven ("Ask Claude in chat to make changes to them").

## Right panel: Properties / Code / Tweaks
- **Layer tree** at the top, shared with the canvas: artboards, then nodes named by role — *Column*, *Row*, *group*, *Text*, *Repeating group (5 items)* — each followed by its first words in quotes, holes shown as written (`"{{p.text}}"`). Notes appear in the tree too.
- Alignment row (left / centre / right / top / middle / bottom).
- **Size**: Width / Height with *Hug / Fixed / Fill*, Min width, Max height, **Position** *Inline / Absolute* (+ X/Y offset), **Grow**.
- **Layout**: *Block / Stack / Grid*; for Stack: direction (→ / ↓), wrap, a 3×3 align matrix, Gap, Padding (single value or per side).
- **Text**: Text style (*Heading 3* …), Color with a live **contrast badge** ("Good contrast"), alignment.
- **Appearance**: Fill (swatch / None), Opacity, Radius (single or per corner), Border (none / solid / dashed / dotted).
- **Effects** section (shadows).
- **Code** tab: the element's own declarations as editable CSS ("Type `color: red;` to style it"), then inherited values grouped "From `<div>`", "From body", each with **+** to override locally.
- **Tweaks** tab: the artboard's `data-props` controls.

## Context menu (right-click)
Cut, Copy, Paste, Duplicate · Move to last / Move to first · Group / Ungroup · Flip horizontal / vertical · Detach instance · **Wrap in flex** (Shift+A) / Wrap in grid · Delete.

## Notes and drawing
- Note tool: click to drop a sticky; a floating format bar appears (size, text colour, bold, italic, list, fill colour). Notes have Width/Max height, absolute X/Y, weight, size in the panel.
- Text tool, Draw (pen), Shapes (rect / oval / line / arrow) create canvas-level items stored in `canvas.json` `notes` with `kind`.

## Saving
- Every change publishes the touched files with `ifMatch` per file; the sync badge shows progress. Undo is per edit (Ctrl+Z).
