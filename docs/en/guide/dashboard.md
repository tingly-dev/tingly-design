<p align="right"><b>English</b> · <a href="../../zh/guide/dashboard.md">简体中文</a></p>

# Dashboard

The sample [`?p=box-usage`](http://localhost:5173/?p=box-usage) is a team's Tingly Box gateway usage for Q3 (generated demo data): requests, tokens, cache hit rate, cost by provider, budgets and per-member usage, built from two live SQLite queries, a CSV and a JSON file, four calculations and a provider filter.

![Dashboard in data mode: a table cell clicked, its source open on the right](../../images/dashboard.png)

```
projects/<name>/
  dash.json               the title and filter defaults
  datasets/<id>.json      where each dataset comes from: a file under data/, or a live query (connector + arguments)
  files/index.html        the page: plain HTML, CSS and script, reading data through the dash API and drawing with d3
  data/                   CSV, TSV and JSON files and SQLite databases
  .runs.json              what the open page reported: datasets that failed, code that threw, numbers that disagree with their data (not in git)
```

- **Data**: file datasets are read directly; query datasets run through a server connector (today `sqlite`, which opens databases under `data/` read-only; see `apps/server/src/connectors.ts` to add others). SQL follows the original's rules: one SELECT or WITH statement, no writing keywords, and each `{{name}}` filter bound as a single literal.
- **Page**: runs in a `sandbox="allow-scripts"` iframe with no network. `dash.data / onData / calc / loader / params / setParams / setLink / colors / refresh` match the original, plus light and dark theme tokens.
- **Checked marks**: every number marked with `data-source` / `data-field` / `data-where` is compared with the cell it points to (understanding thousands separators, K/M/B and 万/亿, percentages and the precision shown), and tables are checked row by row through `data-row-key`. Disagreements are listed under 数据来源 → 问题 (sources → issues) and written to `.runs.json` for Claude Code. Loading, refreshing, failed and empty states are stamped on the elements, so the page can style them.
- **Sources panel**: each dataset's state, row count, update time and whether anything uses it; open one for its description, its query (with `{{params}}` shown at their current values), the result table and the formulas of calculations; edit a query, test it and save it, download CSV, pause a query (its rows are kept as `data/<id>.json`) and resume it.
- **Save as image**: the “Save as image” button in the top bar saves the whole page, as it looks now (theme, filters and loaded data included), as a PNG.
- **Data mode**: click any number, chart or table cell on the page to open its source with that cell highlighted.
- **Code**: the page and the dataset descriptions are editable in the editor too (the original lets only Claude write them); the page reloads on save.
- **AI**: hand it to Claude Code. It can query the databases read-only with `node scripts/dash-query.mjs`, and reads `.runs.json` first.
- **Importing data**: Import in the top bar, or drop CSV, TSV or JSON tables. Each file becomes a dataset, its file stored in `data/` and opened in Sources; a file that is not a table is refused with the reason.

Format reference: [`.claude/skills/dashboard/SKILL.md`](../../../.claude/skills/dashboard/SKILL.md)

---

Back to the [README](../../../README.md)
