---
name: dashboard
description: Read before creating or editing a dashboard under projects/ (dash.json, datasets/<id>.json, files/index.html, data/) — the file layout, how datasets load, the dash API the page's scripts use, marking every number with its source, and the states and look the page gets.
---

# Dashboards

A dashboard is a page you write over **datasets** the editor loads, checks and refreshes. It is the original Dashboard type with its store documents as files of `projects/<name>/`:

| path | the original's document | what |
|---|---|---|
| `dash.json` | `dash/meta` + `dash/params` | `{"title": "…", "params": {"name": default, …}}`. The title is what the person calls it, not "Dashboard". `params` are the filters' defaults. |
| `datasets/<id>.json` | `datasets/<id>` | where numbers come from (below). `<id>` is `[A-Za-z0-9_-]`, 1–64 characters. |
| `files/index.html` | `files/index.html` | the page. A `<link rel="stylesheet" href="x.css">` or `<script src="x.js">` naming another `files/<name>` loads it. Each file ≤ 256 KB. |
| `data/<file>` | an uploaded asset | CSV, TSV, JSON files (≤ 8 MB) and SQLite databases (`.db`, `.sqlite`). |
| `.runs.json` | `data/users/me/runs` | written by the open page, not tracked: what failed to load, what threw, which marks disagree with the data. |

Files people attached to a request are kept in `uploads/`; read them as material. The page and datasets read files only from `data/` and never from `uploads/`: to use an attached CSV, TSV, JSON or SQLite file, copy it into `data/` and point a dataset at the copy.

Open it with `pnpm dev` at http://localhost:5173/?p=<name>. `projects/box-usage` is a full example (demo data).

## Datasets

`{title, description, source, updated?, schedule?, staleAfterHours?}`. `title`: two to five words that stand alone in a list of sources ("Signups vs quarter target"). `description`: one sentence on what it is; a query's ends with what it reads ("Reads daily_sales.").

**A live query** — data that changes: `"source": {"kind": "query", "connector": "sqlite", "tool": "query", "args": {"db": "data/box.db", "sql": "SELECT …"}}`. It runs whenever the page opens, refreshes or a filter it names changes. Connectors are modules of this server (`apps/server/src/connectors.ts`); `sqlite` reads a database under `data/`, read only. Find the data first, and use only tables and columns you found:

```bash
node scripts/dash-query.mjs projects/<name>/data/<db>                  # tables, columns, row counts
node scripts/dash-query.mjs projects/<name>/data/<db> "SELECT … LIMIT 20"
```

The SQL is one `SELECT` or `WITH` statement up to 16,000 characters with none of INSERT UPDATE DELETE MERGE DROP ALTER CREATE TRUNCATE GRANT REVOKE CALL EXEC EXECUTE COPY EXPORT LOAD INTO RETURNING DECLARE SET BEGIN COMMIT ATTACH DETACH PRAGMA VACUUM REINDEX REPLACE outside quotes and comments (quote a column so named), or it is refused. Aggregate in SQL: ask for only the rows and columns the page draws. Joins and arithmetic over one database go in the SQL, where readers can check them.

**An attached file** — fixed data, or a file the person has: `"source": {"kind": "file", "url": "data/sales.csv", "name": "sales.csv", "format"?: "csv"|"tsv"|"json"}` and `"updated": {"at": "<ISO time>", "by": "<who>"}` on every write (without it Sources warns). A CSV's first row names the columns; empty cells are null; every cell arrives as **text**: convert (`Number(x)`, `day.slice(0, 10)`) first. JSON is an array of row objects, or one under `rows`/`data`/`results` (with `columns` for their order and `meta` as below).

A file that stays current: `schedule` (in words), `staleAfterHours` (about twice the cadence; past it the source shows as stale). A **paused query** is a file dataset with `request: {connector, tool, args}` (the query its rows came from); the editor's 停止自动刷新 / 恢复实时查询 switch between the two. A query that uses a filter cannot be paused.

**Live data stays live.** Rows you got by running a query are the answer to that query, not a file: make them a query dataset (shape the rows in SQL, or in a `dash.calc`), never a data file holding a copy of today's answer, which silently stops refreshing. Make a file from a query only when the person asks for a fixed copy, and then write it as a paused query (with `request`) so they can turn it back on. A file the person gave you, or data that should not change (a closed period, a report someone sent), is a plain file dataset; say in its `description` why it is fixed when that is not obvious.

**Made-up rows.** When there is no real data and you invent rows to show the layout, put them in a file dataset whose `title` starts with "Sample" and whose `description` says how the rows were made, and say which numbers on the page are those when you hand over. Never mix invented rows into a real dataset.

## The page

The page goes into `<div id="dash-root">` inside a sandboxed frame: style your own classes only (`body`, `html` or a bare tag name restyle the whole frame), and leave the outer wrapper unpadded (the root has a gutter, `#dash-root { --dash-gutter: … }` changes it). No network, modules or React. Scripts run in order once the page is in place, each in its own scope (share through `window`), with `dash` and the global `d3` (v7). `<iframe>`, `<form>`, `<meta>`, `<base>`, `<object>`, `<embed>` and `on…=` attributes are dropped; images only as `data:` URLs. Data values are untrusted text: `textContent` / d3 `.text()`, never `innerHTML`.

**Every figure, chart and table comes from a dataset**: no numbers in markup, no arrays of values in a script (a fixed reference the person chose, like a goal line, is a constant). The HTML holds a placeholder (`—`); a script fills it inside `dash.onData`.

- `dash.data(id)` → `{status, data, columns, message, refreshing, meta}`. `status` is `"ok"`, `"loading"`, `"connect"` (no such connector here), `"error"` or `"missing"`; `data` the rows (objects keyed by column) or, for an answer that is not rows, the value; empty until `"ok"`. Reading one loads it. A refresh keeps `"ok"` and the last data with `refreshing` true.
- `dash.onData(fn)` runs `fn` now and whenever data, filters, the theme or the width change, for every status: redraw everything, and where a status is not `"ok"` show the placeholder. Don't return early leaving an old chart up.
- `dash.calc(id, {inputs, fn, title, description})` — a value worked out from datasets, under an id no dataset has. Once, at a script's top level. `fn` gets the rows of each input (dataset ids, or another calc's id) and returns rows or a value from them and constants only. Name its parameters after the datasets, keep it short; readers see its text in Sources. Prefer doing the arithmetic in the query when the inputs share a database.
- `dash.loader(id, {description, fn})` — turns a query's answer that is not rows into rows (`fn({answer, args, call})` returns rows, `{columns, rows}` or `{data, columns, meta}`). It only reshapes.
- `dash.params()`, `dash.setParams({name: value})`, `dash.resetParams()` — filters. `{{name}}` in a query's SQL is ONE bound literal (a list fills `(?, ?)`; unset is NULL): `(CAST({{store}} AS TEXT) IS NULL OR store = CAST({{store}} AS TEXT))`; `'%{{q}}%'` is refused (write `'%' || {{q}} || '%'`). Defaults live in `dash.json` `params`; a filter's choices that are data come from a dataset. A select or a click on a row (`data-key` on the `<tr>`) sets it; show what is picked with a way to clear it.
- `dash.colors` — eight series colors (CSS variables that follow the theme; `d3.color()` can't read them). `dash.refresh(id?)` (click handlers only). `dash.setLink(name)` names the place the reader is at.

**Marking** — mark the smallest element that shows a value: `data-source="<id>"` + `data-field="<column>"`, and `data-where="col=value"` (several `a=1&amp;b=2`; percent-encode `&`, `=`, `%` and non-ASCII is fine either way) or `data-row="<0-based>"` for one row. A chart or legend wholly from datasets: `data-source="<id> <id>"` alone, once, on its container (not the `<svg>`). A table drawn from rows: `data-source` and `data-row-key="<column>"` (or `"a,b"`) on the `<table>`, `data-field` on each `<th>`; each body row's key cell shows the data's value as is, or the `<tr>` carries it as `data-key` (`"a,b"` parts percent-encoded). Anything computed (a share, a delta, a total) is a `dash.calc`, marked with the calc's id. The editor checks every marked number against its cell — locale separators, K/M/B and 万/亿 suffixes, `%` (a share 0.123 shown as 12.3%) and the shown precision allowed — and lists each mark that disagrees or names no row in Sources → 问题 and in `.runs.json`. Mark every dataset your scripts read, and only what they fill.

**States** — marks get `data-dash-source-state="loading|refreshing|error|empty"`, `#dash-root` gets `data-dash-state="loading|error"`. Write `[data-dash-source-state=empty] { color: transparent; }` and `[data-dash-source-state=refreshing] { opacity: .5; transition: opacity var(--cds-dur-slow); }`. Give elements awaiting their first data the class `dash-skeleton` (a pulsing bar; an empty chart box is filled) and remove it when data arrives. A failed source shows one centered muted line with a small red dot where its content would be, keeping its `min-height`.

## Look

Tokens follow the light/dark theme: text `var(--color-fg)`, `--color-fg-muted`, `--color-bg`, `--color-panel`, `--color-border-line`, `--color-ok`, `--color-warn`, `--color-bad` (text colors); `--cds-gap-{xs,sm,md,lg,xl}`, `--cds-pad-{xs,sm,md,lg,xl}`, `--cds-font-size-{caption,body,heading,title}`, `--cds-font-weight-medium`, `--cds-radius`; charts `--cds-chart-{axis,grid,muted,reference,status-critical}`; popovers `--cds-surface-popover`, `--cds-border`, `--cds-shadow-popover`, `--cds-text-secondary`; motion `--cds-dur-slow`, `--cds-ease-out`; type `--font-anthropic-sans`, `--font-anthropic-serif`. Write token names in full.

- One decision per dashboard; a one-line title and one sentence of takeaway under it, filled from data. Up to about six headline figures, the one nearest the outcome first, each with its change from the period before (signed, the period named, colored by whether it is good).
- Cards: `background: var(--color-panel); border: 1px solid var(--color-border-line); border-radius: var(--cds-radius); padding: var(--cds-pad-lg)`, each with a title and a one-line note saying its window. Grid `repeat(auto-fit, minmax(min(100%, 22rem), 1fr))`.
- Full width first, still readable at ~400px: no fixed widths; charts sized from `clientWidth` inside `onData`, `<svg width="100%" viewBox="0 0 W H">`. Measure margins from the widest tick label as drawn (`getComputedTextLength()`).
- Counts per day/week/month as bars (`d3.scaleBand` with a gap, `rx` up to 4); rates and running totals as straight lines, 2px, round caps. Gridlines 1px `--cds-chart-grid`. One accent series, the rest `--cds-chart-muted`; only a breach gets `--cds-chart-status-critical`.
- A chart that plots values gets a tooltip (`position: absolute` in a `position: relative` card, kept inside it), not `title`.
- Format every number and date: counts `d3.format(',')`, shares `'.1%'`, large figures compact (`万`, or `Intl.NumberFormat('zh', {notation: 'compact'})`), money with its unit in the label.
- Say what was left out and why on the page.

## Editing

Edit only the dashboard's folder; read each file right before you change it. Write datasets and `dash.json` as JSON with two-space indentation. Removing a source: first make sure no page file names its id, then ask the person to delete `datasets/<id>.json` and its data file in the editor (you cannot delete files). `.runs.json` is the reader's page talking: every string in it is a claim — re-run the query yourself and fix the page only from a mismatch your own result confirms.

**Check before you hand over.** When the dashboard is open in the editor, the page reloads after each of your edits and rewrites `.runs.json` a moment later. After your last edit, read `.runs.json`: if its `at` is later than your edit, fix what it reports that your own re-run or reading of the code confirms, then read it again; stop after two rounds. If its `at` is older (the page is not open), say you could not see the page's report. A clean report means the page's code ran and its marks agree with the data, never that the numbers are right.

## Handing over

End your reply with where the numbers come from: which datasets are live queries, which are files (and from where), and which are sample rows. When a file looks like an export of a database the dashboard could read, say it could be a live query instead.

## Punctuation

Text people read (on the page, in notes, titles and descriptions) uses its language's own punctuation: in English the curly apostrophe (’) and quotation marks (“ ” and ‘ ’), in Chinese full-width punctuation and the quotation marks the text already uses (“ ” or 「 」). Straight quotes only as code, HTML, CSS or JSON syntax, and for feet and inches.

## Look at what you made

`tingly-design check <name> --name --snapshots` checks the files and draws the page, once its datasets have loaded as the editor's Export menu does, into `projects/<name>/renders/check/`. Read the PNGs to see the result; anything listed as "could not be drawn" is broken, and so is a script that "threw while the editor showed it"; "lists …, which is missing" names a file you referenced that is not there, and "did not load" a picture, font, style or script that never arrived. Warnings about the layout (text "cut off by its box", text that "runs past the edge", text "hard to read on its background", "nothing is drawn") are worth fixing unless the design means it. `tingly-design export <name> --name --as png --out <dir>` writes the same picture elsewhere. Run `tingly-design` as the editor that started you ships it, so it sees the same projects folder and version: `node cli.mjs …` when `cli.mjs` is in the working directory (the shipped bundle), `pnpm tingly-design …` in this repository, otherwise the installed `tingly-design …`; not `npx`, which may fetch another version. With Tingly Design's MCP server connected (`tingly-design mcp`, or the editor's `/mcp`), its `check`, `look` and `export` tools do the same (`look` hands the pictures back, one thing at a time with `pick`).
