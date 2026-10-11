# What the Dashboard runtime does (read from its bundle, 2026-10-11)

Line numbers refer to `type/app.pretty.js` unless another file is named.

## 1. Store model and how the page reads it

- **Capabilities.** The type declares these in `<meta name="appifact-capabilities">` (`type/index.html`): `db`, `assets`, `downloads`, `comments`, `room`, `user{scopes:[profile]}`, and `mcp{servers:[{server:"BigQuery",tools:[bigquery_query,semantic_query,list_knowledge]}],dynamic:true}`.
- **db rules.** `{path:"",write:"admin"}` and `{path:"data/users/{self}",read:"view",write:"interact"}`. Only editors write content, and every viewer writes their own `runs` document.
- **Reaching a capability.** `Y1(name, pred)` (:55346) reads `globalThis.claude[name]` directly, or calls `await claude.use(name)` with a 45 s timeout.
- **Collections.** The runtime subscribes to `datasets`, `files` and `dash` (`SO0` :82154). It uses `db.collection(c).limit(1000).onSnapshot(...)` with `docChanges()`, `metadata.fromCache` and `hasPendingWrites`. Writes go through `db.doc(path).set/update/delete`.
- **Normalised content.** The documents become `{params, datasets[], files[]}` (`hB0` :57070).
  - Dataset ids match `/^[A-Za-z0-9_-]{1,64}$/`.
  - File names match `/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/`.
  - A file's text is at most 256 KB.
  - `lc()` parses each dataset. Its kind comes from the stored `kind`, or is inferred from `tool`, `url` or `rows`.
- **Per-user documents** (`data/users/<viewer>/…`):
  - `runs` (:80565): written debounced at 1 s, retried 3 times on `unavailable`, and deleted when everything is ok. It is capped at 256 KB, 100 datasets and 20 marks.
  - `history-<datasetId>` (:80794): `{entries:[{at,args}]}`, the viewer's query-edit history. It keeps 90 days and at most 200 KB.

## 2. The `dash` API (`$75`, :77700–77810, set as `window.dash`)

- **`data(id)`** returns `{status, data, columns, rows, message, refreshing, meta, value?}` (`po` :77600). Status is one of `missing`, `error`, `loading`, `connect`, `declined` or `ok`. Calling `data(id)` marks the dataset as asked for, which loads it.
- **`onData(fn)`** runs `fn` once now and again on the next animation frame after any data change (`no()` :77887). If `fn` throws, the page shows "This page's code stopped (a dash.onData callback)".
- **`calc(id, {inputs, fn, title, description})`** goes through a calc engine (`oF0`). A calc may use other calcs as inputs.
- **`loader(id, {description, fn})`** calls `fn({answer, call, args, read})`. `read` has the parsers `bigquery`, `governed`, `snowflake` and `databricks`. The loader's `call`s are whitelisted per connector, refuse disallowed SQL, are spaced 2 s apart and give up after 3 min (`gn0` :59596).
- **Filters:** `params()`, `setParams(obj)` (values sanitised by `dc`) and `resetParams()` (which sends `setParams(null)`).
- **`setLink(name)`** posts `parent.postMessage({type:"current_anchor",fragment})`, then calls `history.replaceState('#'+name)`.
- **Other members:**
  - `colors` (tokens `categorical-1..8`) and `refresh(id)`.
  - Undocumented: `format`, `scale{linear,band,time}`, `ticks`, `path{line,area}` and `svg`.

### Mark validation (:57201–57340, :77200–77300)

- `data-source` is split on whitespace.
- `data-where` is split on `&`, then on `=`, then URI-decoded.
- `data-row` must be an integer ≥ 0.
- Each mark resolves to row indexes. When it can't, the error is one of "no column “x”", "no matching row" or "data-where isn’t col=value".
- To check a number, the runtime parses the shown text. It handles locale group and decimal separators, K/M/B suffixes, `%` and signs. It compares the result with the cell by rounding step, also trying the cell ×1000, ×1e6, ×1e9 and ×0.01.
- The verdict is one of match, mismatch, unresolved, pending, plain or resolves. An empty or dash value with no row counts as "resolves".
- Up to 20 problem marks go into `runs.marks` as `{mark, source, field, where, row, shown, inData | reason}`.
- `B75` also tracks datasets the page reads but no mark names, and datasets a mark names but the page never reads.
- **Tables:** `data-row-key` is handled by `vA0` (:77300), which writes a hidden `data-row-key-value` attribute on each row.
- **States:** marks get `data-dash-source-state` and `aria-busy`. The root gets `data-dash-state`, with a 500 ms delay before it shows loading.

### Sources panel

- It lists every dataset and labels unused ones "Unused". It has a Refresh button.
- A "Data mode" toggle turns on click-to-inspect: "Click a number or a chart to see its source".
- A source's page has Query, Transform and Result sections, Formula and Result for a calc, or File.

## 3. Dataset loading

### Query datasets (`ES` :59680)

- A query runs as `claude.mcp.callTool(connector, tool, args, {cache:{gcTime:86400000}})` (`KF0` :58779).
- Pre-checks before the call:
  - the connector and tool are named;
  - the tool is allowed for that connector;
  - the SQL passes a keyword/literal tokenizer (`Sd`, `Sr0` :58440).
- `{{name}}` placeholders are filled by the regex `rq`.
- `watchTool(..., {cache})` (`zF0`) first delivers the cached answer (`result.cache.storedAt`) through `onCached`. The browser keeps a query's last answer for up to a day.
- The answer is unwrapped from `structuredContent`, `payload` or `content[].text` as JSON.
- `h9` turns row objects into a table. Anything else becomes a `value`, or rows through a loader.
- Errors map to states:
  - `needs_reauth` → reauth
  - `server_not_connected` → absent
  - `not_in_manifest` / `not_granted` → declined ("X is turned off…")
  - `consent_required` → connect
  - `permissions.state("mcp:"+connector)` resolves prompt/denied.
- Results over 8 MB are refused.

### File datasets (`fH0` :58395)

- Only urls matching `/^\/?_blob\/[0-9a-f]{32}$/` are read.
- The file is fetched with `fetch(url,{credentials:"same-origin"})`, a 20 s abort and an 8 MB cap.
- The format comes from the extension (`.tsv` or `.tab`, `.json`, otherwise csv) unless `format` is set.
- The CSV parser is hand-written: it strips a BOM, handles quotes, and turns empty cells into null.
- JSON is either rows, or rows under `rows`, `data` or `results`, with an optional `meta`.

### Staleness, pausing, schedules

- **Stale:** `now − updated.at > staleAfterHours·3600000` (:60097).
- **Pause:** the UI uploads the current rows as JSON `{columns,rows,meta}`. It then sets the dataset to `{source:{kind:"file",url,name:id+".json"}, request, updated, lastAttempt, pausedBy}` (:83500). It refuses to pause a query that has no rows or was cut short. Readers never re-run `request`.
- **Schedules:** there is no scheduler. `schedule` is only displayed; a routine or Claude refreshes the data.

## 4. Page injection and sandbox (:77519–77700)

- `files/index.html` is parsed through `<template>.innerHTML`.
- A `<link rel=stylesheet href=X>` becomes a `<style>` holding `files/X`.
- A `<script>` with no type or a JS type is collected, inline or from `files/<src>`.
- These elements are removed: `script`, `link`, `meta`, `base`, `form`, `iframe`, `frame`, `frameset`, `object`, `embed`, `portal`, `fencedframe`. Every `on*` and `ping` attribute is removed too.
- **No iframe:** the cleaned body goes straight into `#dash-root` with `replaceChildren`. CSS scoping is by convention only.
- Each script runs as `Function("dash","(function(){…}).call(this)")(dash)` with a `//# sourceURL`. Errors are recorded as "stopped".
- `window.d3` is a bundled subset of d3, without d3-dsv or autoType.
- The page can use these tokens:
  - `--cds-gap-*`, `--cds-pad-*`
  - `--cds-font-size-{title,heading,body,caption}`
  - `--cds-radius`
  - `--cds-chart-{axis,grid,muted,reference,status-critical}`
  - `--cds-surface-popover`, `--cds-shadow-popover`
  - `--color-*`, `--font-anthropic-{sans,serif}`

## 5. Editing

- **No hand editing of the page.** The generic Frame toolbar has Edit/Save (`ed0` :54791), but it looks mounted without `onToggleEdit`; I inferred this from its use at :55074. The page changes only when Claude writes the store.
- **Edit query** dialog in Sources (:82820):
  - one field per argument, with `{{param}}`s shown as read-only chips;
  - JSON validation and a 16,000-character limit;
  - **Test** runs the query without saving, and **Save** writes `args` to `datasets/<id>`;
  - **Save anyway** appears when columns are missing or the source needs connecting;
  - **History** (from `history-<id>`) and **Restore**, which only fills the fields ("Nothing changes until you save").
- Sources also has **Pause** and **Resume**.

## 6. `features.md` in brief

- **Filters (`dash/params`):** `{name: default}`.
  - `{{name}}` fills exactly one SQL literal; `'%{{q}}%'` is refused.
  - An optional filter is `CAST(...) IS NULL OR …`.
  - A list filter is `IN {{plans}}` with an `any_` flag.
  - Controls are a plain `<select>` or `<input type=date>`, with no `<form>`. Clicking a row (`data-key`) or a bar can set a filter.
- **Pages:** sections of `index.html`. A `<template>` loads lazily, hidden pages are skipped in `onData`, and `setLink` gives deep links.
- **Loader:** reshapes only. It returns `{data,columns,meta}`, where `meta` is `[{label,value,type:"code",lang:"sql"}]`.
- **A file that stays current:** `schedule`, `staleAfterHours` (about 2× the cadence), `request` (paused, with no parameters) and `lastAttempt{at,ok,error,by}`.
- **Runs document:** `{params, datasets:{id:{status,message,rows,cut,ms,at}}, marks, flagged, errors[{kind:error|rejection|stopped,name,message,file,count}]}`.
  - connect, declined, reauth and absent are the viewer's to fix.
  - failed and refused are Claude's to fix.
- **View context:** `{mode:data|page, place, selected, at, field, filters, failed, failures[{id,label}]}`. The runtime builds it (`JT0` :83185). It is probably sent through the frame chrome's postMessage report (:51280), but I didn't confirm that.
- **Removing a source:** delete its `datasets/<id>` document and its asset. An old `kind:"rows"` dataset is converted to an uploaded JSON file.
