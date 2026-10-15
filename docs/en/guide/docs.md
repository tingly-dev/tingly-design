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

- **Rich text**: a TipTap editor with a toolbar, a menu on selected text, and `/` on an empty line to insert headings, lists, tasks, quotes, code, tables, dividers, images and dates; tabs on the left (add, nest, rename, reorder, delete) and the outline.
- **Block-level write-back**: the editor produces the tab's Markdown, and `mergeBlocks` in `packages/core/src/docs.ts` merges it back into the file: blocks whose meaning did not change are kept byte for byte, and inside a changed block the unchanged lines (list items, table rows) are kept too. Tick a task or edit a cell and the git diff is one line. If someone else (or Claude Code) changed the file meanwhile, your edits are replayed block by block; outside changes appear in the open tab live, without losing your cursor.
- **Comments**: select text and comment; a thread is anchored to the quoted words (plus context) and highlighted while they exist; reply, resolve, delete, or hand the thread to Claude, which reads it, edits the document accordingly and replies in the thread.
- **AI rewrite**: on a selection, "shorter", "polish", "more formal" or your own instruction; the model streams a new passage that replaces the selection or goes below it (needs `ANTHROPIC_API_KEY`). Whole-document work goes to Claude Code.
- **Layout and export**: heading and body typefaces (serif or sans), page width; export the current tab or the whole document as Markdown or HTML, the current tab as a PNG image, or print to PDF.
- **Import**: Import in the top bar, or drop Markdown files (with their folder). Each file becomes a new tab titled by its first heading; its pictures and the original stay in `uploads/`.

Format reference: [`.claude/skills/docs/SKILL.md`](../../../.claude/skills/docs/SKILL.md)

---

Back to the [README](../../../README.md)
