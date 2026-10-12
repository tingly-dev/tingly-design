# Project kinds

Each kind is a folder under `projects/<name>/`. The file formats follow Claude's Design, Slides, Design System, Dashboard and Docs artifact types; Tingly Design is an open-source re-creation of their two-way editing. The full format for each kind is in `.claude/skills/<skill>/SKILL.md`.

## Canvas

Artboards are `.dc.html` files: a template with `{{path}}` holes, `<sc-for>` loops and `<sc-if>` conditions, plus a small component class. Notes, shapes and arrows live in `canvas.json`. Select, drag to reorder or drag out to a free position, retype in place, and run artboards in play mode, where links between them navigate.

## Slides

A deck is `deck.json` plus one HTML file per slide, written in a closed HTML/CSS subset. Every slide is checked against that subset, and a fast AI edit that breaks it is undone and retried. Present with F5, or download a single HTML file, a PDF or the speaker notes.

## Design system

Colours (per theme), type, spacing, radius and shadow live in `tokens.json`, and `tokens.css` is rebuilt from it with only the lines that changed. Install a system into a canvas or deck and its colour fields and text-style menu offer the tokens.

## Dashboard

Datasets are files under `data/` or live read-only SQLite queries. The page is plain HTML and script that reads data through the dash API. Every number marked with its source is compared with the cell it points to, and anything that disagrees is reported.

## Docs

Tabs and subtabs of Markdown, comments anchored to the words they quote, AI rewrite of a selection, and export to Markdown, HTML or PDF. Hand a comment thread to Claude Code and it edits the doc and replies in the thread.

## Not there yet

| Kind | Planned, not built |
| --- | --- |
| Canvas | Comments, multi-select, PDF export |
| Slides | Magic move, PPTX and Google Slides export, image cropping |
| Design system | Mounting components on a canvas, an in-page model |
| Dashboard | MCP connectors such as BigQuery, query history, scheduled refresh |
| Docs | Word and Google Docs export, version compare and restore, live cursors, @mentions |

Fast AI edits one artboard or passage at a time; work that spans several files goes to Claude Code, which edits them directly.
