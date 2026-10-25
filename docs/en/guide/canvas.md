<p align="right"><b>English</b> · <a href="../../zh/guide/canvas.md">简体中文</a></p>

# Canvas

The top left holds the page menu and the tools; the top right holds play, the panel toggle, **Import / Export**, zoom and the sync log (a history icon whose dot is green when saved, blue while saving and red when offline); the bottom bar is the prompt for AI (paste, drop or pick images, PDFs and text files into it; they are kept in the project's `uploads/`; the request you sent stays above the box with each step the AI is taking, how long it has run and which files it changed, and you can stop it, undo the whole run, or put a failed request back in the box; the card floats above the box, so nothing on the stage moves while it runs; the chevron in the bar's header folds it to a small pill and the clock button lists your earlier requests; the position button in the header moves the whole prompt into a column on the left that stays open and keeps the conversation: every request with the steps the AI took, what it answered and the files it changed, also after a reload and including requests sent from the terminal (a window too narrow for the column puts the prompt back at the bottom); drag the edge of the column, or of any side panel, to make it wider or narrower, double-click the edge to reset it; a chip says whether Claude Code starts a new conversation or continues the last one, and clicking it switches; this works the same in every kind); the right panel folds away with `⌘\`. If you know jQuery, its **Code** tab has a box under the source where you can type statements yourself (no API key needed); a fast AI run's statements can be taken there with "在 jQuery 里改" to adjust by hand.

- **Tools**: select V, hand H, text T, artboard A, sticky note N, pen P, rectangle R, ellipse O, line L, arrow ⇧L. Notes and shapes live in `canvas.json`, with size (s/m/l/xl/xxl), colour, fill, rotation and flips.
- **Import / Export**: one menu for both. Import takes pages and SVGs as new artboards and pictures onto the canvas (or drop or paste them anywhere); export saves the selected artboard as PNG (1× or 2×) or its source file, or every artboard on this page as PNG files, and “Copy as PNG” puts the selected artboard on the clipboard. At the end of the same menu, “Whole project (.zip)” saves the project itself: every file, its change log and the design systems it installed, beside it; “Project files only (.zip)” leaves those two out. “Import a project package (.zip)…” in the home page's New menu opens it again (a name already taken gets `-2`), and so does a project folder you zipped yourself.
- **New canvas**: after the title, pick the first artboard's size from named sizes in ten groups, each with its width and height and a line under them saying where it is used: Screen (Artboard 1200×760, the default, Desktop, Phone), Slides (16:9, 4:3), Posts and video (square, portrait 4:5 and 3:4, story 9:16, link preview card, video thumbnail), WeChat (Official Account cover 900×383, small cover 200×200 and guide image, Channels cover landscape 1080×608 and portrait 1080×1260), Chinese platforms (Douyin, Weibo, Bilibili), Global platforms (Instagram, X, LinkedIn, Facebook, Pinterest, YouTube), Web ads (medium rectangle, leaderboard, billboard, half page, skyscraper) and Print (A4, US Letter); or choose Custom and type any width and height (1–7680 px). The same list is in the artboard panel's Preset menu, and `tingly-design new canvas <name> --size wechat` takes it from the [command line](../cli.md).
- **Artboards**: rename, run full window or export PNG (1× or 2×) from the name strip; resize from the corner; several pages, each with its own artboards.
- **Right panel**: the layer tree, named by role (row, column, grid, text, image…, with loops marked), with an eye and a lock on every row: hide something without deleting it, lock it so a click on the stage lands on what holds it, it can't be dragged, and its properties, the Delete key, cut, reorder and wrap leave it alone (the panel says so and has an Unlock button); Shift-click or ⌘/Ctrl-click several rows and hide or lock them together from the bar under the tree; Alt-click an eye to keep only that layer of its level shown; the same tree and switches work in slides and motion (a hidden layer is written as `data-hide`, a locked one as `data-lock`, or `hidden` / `locked` for an artboard or item in `canvas.json`); properties (text style, hug/fixed/fill sizing, direction and gap, fill, stroke, radius, shadow, opacity); code (the element's own declarations are editable, inherited values listed read-only); Tweaks (edits the `data-props` defaults, every prop listed, one without an `editor` as text, a switch or a number by its default; double-click text that shows such a text prop, alone (`{{heading}}`) or inside copy (`Hello {{name}}!`), and you retype the prop or the surrounding words while the template keeps its holes; rows of a list prop (`"plans":{"default":[…]}`) inside `<sc-for>` are retyped the same way, and text fed only by the artboard's script says so instead of doing nothing; a colour set by a hole (`color:{{accent}}`) shows in Properties as the colour it is, and changing it there changes the prop; an artboard that declares `$time` moves with time, and Tweaks has a time slider and play to look at any moment without changing the file. Slides and motion pieces import such artboards as effects). With nothing selected, a **Template values** section under Canvas lists every artboard's values, grouped by artboard, edited with the same fields (undoable); click an artboard's name to select it and bring it into view; past 30 values a filter appears).
- **Direct manipulation**: drag a selected element to reorder it among its siblings; drag it out of its parent to position it freely (the parent becomes `position:relative` and keeps its height); resize from the handles; double-click to retype; right-click for the context menu (including **Copy as PNG**, a picture of the element or the whole artboard on the clipboard).
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
| ⌘Z ⌘⇧Z | Undo / redo (see below) |
| ⌘= ⌘- ⌘0 ⇧1 ⇧2 | Zoom in, zoom out, 100%, fit all, zoom to selection |

</details>

## Undo, redo and the change log

Every kind works the same way.

- **Undo / redo** (`⌘Z`, `⌘⇧Z`) steps back your own last change and brings it back. It finds your change by its context, so it still works after someone else (a fast AI run, Claude Code, an outside editor) changed other parts of the same file, and what they changed stays. The history lives in this editor session (the last 100 changes) and is cleared when you close or switch the project. A Claude Code run can also be undone as a whole from the button on its result.
- **The change log** (the sync log at the top right) is a record: one line per change saved to a file, with who made it (by hand, fast AI, Claude Code, an outside editor, undo), when, and what was asked. A line is not a snapshot; you cannot jump back to it.
- **Commit to git** (in the change log) is the snapshot: it commits this project's folder to the git history in your projects folder, with a message you write. It is how you keep a version you can return to with git. Undo does not change commits, and committing does not clear undo.

Format reference: [`.claude/skills/dc-canvas/SKILL.md`](../../../.claude/skills/dc-canvas/SKILL.md)

---

Back to the [README](../../../README.md)
