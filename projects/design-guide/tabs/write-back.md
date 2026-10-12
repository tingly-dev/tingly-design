# Write-back and sync

Every change, whoever makes it, ends as a small text patch against the file it came from. This page explains how that works and what it means for you.

## One write-back engine

Canvas artboards and slides are HTML. parse5 parses the source with locations, and the editor works on a copy in which each element remembers the span of source it came from. When an edit finishes, the copy is compared with the original:

- only an attribute changed: that one attribute is replaced;
- only text changed: that text is replaced;
- children were added, removed or reordered: the parent's inside is rewritten, copying untouched children from the original text.

Styles are edited as text, so a declaration with a template hole such as `background:{{r.bg}}` is never lost. Direct edits, fast AI and replays after a conflict all go through this one engine in `packages/core/src/copy.ts`.

## Docs are merged block by block

A doc tab is Markdown. The editor produces the whole tab, and `mergeBlocks` in `packages/core/src/docs.ts` keeps every block whose meaning did not change byte for byte. Inside a changed block, unchanged lines such as list items and table rows are kept too. Tick a task or edit a table cell and the git diff is one line.

## Versions and conflicts

Each file's version is a hash of its content. A save names the version it was based on; if the file changed in the meantime, the server answers 409 with the current content, and your edit is replayed on the new version. Two people editing the same file at once both keep their changes, and undo finds your own change by its context even after others have edited around it.

## The journal

The journal records who changed what and when: direct edits, jQuery, fast AI, Claude Code, outside edits and undo. It is pushed live to every open editor and is part of the fast AI context, which is why a follow-up like "one more" or "a bit less" is understood.
