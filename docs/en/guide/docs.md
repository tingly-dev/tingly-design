<p align="right"><b>English</b> · <a href="../../zh/guide/docs.md">简体中文</a></p>

# Docs

The sample [`?p=design-guide`](http://localhost:5173/?p=design-guide) is the Tingly Design handbook: four tabs (one nested), a project-kinds table, a setup checklist, a quote, a code block and two comment threads.

![Docs: the format and AI rewrite menu on a selection, comments on the right](../../images/docs.png)

```
projects/<name>/
  doc.json          the title, tabs (order and nesting) and layout settings
  tabs/<id>.md      one Markdown file per tab (GFM: tables, task lists)
  comments.json     comment threads, anchored to the words they quote
  assets/           uploaded images
```

- **Rich text**: a TipTap editor with a toolbar, a menu on selected text, and `/` on an empty line to insert headings, lists, tasks, quotes, code, tables, dividers, images and dates; tabs on the left (add, nest, rename, reorder, delete) and the outline. Links open with ⌘/Ctrl-click or the selection menu's open button. The selection menu also colours words (red, orange, green, blue, purple, gray; the colour is a name that is drawn with a colour that reads in light and dark, and the file keeps `<span data-color="red">words</span>`, so Markdown export keeps the words and the HTML, PDF and PNG exports keep the colour).
- **Block-level write-back**: the editor produces the tab's Markdown, and `mergeBlocks` in `packages/core/src/docs.ts` merges it back into the file: blocks whose meaning did not change are kept byte for byte, and inside a changed block the unchanged lines (list items, table rows) are kept too. Tick a task or edit a cell and the git diff is one line. If someone else (or Claude Code) changed the file meanwhile, your edits are replayed block by block; outside changes appear in the open tab live, without losing your cursor.
- **Code blocks that draw themselves**: a fence tagged `mermaid` draws a diagram, `latex` a formula and `csv` / `tsv` a table (`/diagram` and `/formula` insert them). Click one to see and edit its source; a source that cannot be drawn says why and keeps the text. The file always keeps the plain fence.
- **Claude Code sees what you see**: the bar at the bottom tells it the open tab, the section and block the cursor is in, your selection, and the comment thread you have open, so “shorten this” needs no pasting.
- **Tables as CSV**: with the cursor in a table, the toolbar's CSV button downloads it as a `.csv` (the header row becomes the column names). The reverse is a ```csv fence, which draws as a table. A table wider than the page scrolls in place.
- **Earlier versions**: before an edit replaces a tab, the text it replaces is kept (at most one a minute, the newest 40, on this machine only, not in a zip or a commit). The top bar's Earlier versions button lists them; pick one to read it and Restore puts it back as an ordinary edit; the text it replaces is kept first, so it can be restored in turn.
- **Comments**: select text and comment; a thread is anchored to the quoted words (plus context) and highlighted while they exist; reply, resolve, delete, or hand the thread to Claude, which reads it, edits the document accordingly and replies in the thread.
- **AI rewrite**: on a selection, "shorter", "polish", "more formal" or your own instruction; the model streams a new passage that replaces the selection or goes below it (needs `ANTHROPIC_API_KEY`). Whole-document work goes to Claude Code.
- **Layout, import and export**: heading and body typefaces (serif or sans), page width; the “Import / Export” menu brings Markdown in and saves the whole document as a PDF in one click (A4, made by the Chrome on the machine running the server; with none, it opens the print dialog), the current tab or the whole document as Markdown (the doc’s title and tabs become headings in order, `==highlight==` becomes `<mark>`, comments are left out; with local pictures it is a `.zip` holding the `.md` and the pictures beside it), the whole document as HTML, and the current tab as a PNG image or, with “Copy as PNG”, as a picture on the clipboard. At the end of the same menu, “Whole project (.zip)” saves the project itself: every file and its change log; “Project files only (.zip)” leaves the change log out. “Import a project package (.zip)…” in the home page's New menu opens it again (a name already taken gets `-2`), and so does a project folder you zipped yourself.
- **Import**: Import in the top bar, or drop Markdown files (with their folder, or the `.zip` a doc was exported as). Each file becomes a new tab titled by its first heading; its pictures and the original stay in `uploads/`.

Format reference: [`.claude/skills/docs/SKILL.md`](../../../.claude/skills/docs/SKILL.md)

---

Back to the [README](../../../README.md)
