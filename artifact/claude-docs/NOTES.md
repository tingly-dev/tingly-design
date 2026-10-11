# Docs type — notes

Source: the type's `SKILL.md` as shown by `Artifact read` on the type link
`https://claude.ai/artifact/Rp9naXUCj2xozpUkyQy19W`, release `1791658616-c881`,
2026-10-11. The user has no Docs artifact yet, so the type's files (a Vite
build: `index.html` + ~85 chunks under `artifact-type/`, e.g. `RightRail`,
`TabsLeftList`, `VersionBar`, `SparkMenu`, `MarkdownRenderer`,
`DocFontControl`, `WidgetConsolePanel`) were not fetched. They become readable
through any instance.

## Model (paraphrased from SKILL.md)

- The artifact is only a **viewer**. An instance owns **no files**: a doc's
  title, tabs, blocks, comments and permissions live in a separate "Claude Docs"
  service, keyed by the artifact id. Publishing files into the artifact is
  wrong (strays block viewer upgrades).
- Everything is read and written through the **Claude Docs connector**
  (MCP): `batch` (create a doc + land its skeleton atomically),
  `update` (edit one tab: blocks addressed by id), `read`, `query`
  (comments), `create`, `delete`, `export`, `guide`.
  - Wire words: `project` = a doc, `file` = a tab, `node` = a tab's
    contents, `utterance` = a comment.
  - Creating: `container: {"kind":"project","create":{"name","artifact":<url>}}`
    plus skeleton blocks; ack carries `created.bound`.
  - Skeleton: markdown with `<?claude block k?>` processing instructions that
    point at typed blocks (`pending` with an `intent`, `date`, `mention`, …);
    each `pending` is later replaced with `## heading` + body.
- **Live collaboration**: everyone with the link sees edits arrive live;
  every tab has a `rev` returned by every read/write; `read` with `sinceRev`
  gives a diff.
- **View context** sent with the user's messages while the doc is open:
  `{mode, tab, node, selected (block ids), dirty, rev, edits}`.
- **@Claude in the doc**: a page send carries `{request, instruction, tab,
  nodeId, blockId, label}`; the answer is written into the doc at that block,
  not as a comment.
- **Comments** belong to the doc (connector `query` / comment create with
  `parent` = thread root), not to the artifact's comment relay. A comment turn
  carries `Element path: f-<tab>#<node>/<block>;thread=<root>`.
- Blocks besides prose: tables, charts (with uploaded data files), diagrams,
  uploads; exports to Word, PDF, Markdown, Google Docs.

## What it means for tingly-design

Unlike Design / Slides / Dashboard, Docs is **not file-backed**: the source of
truth is a block tree with stable block ids and a per-tab revision. An
open-source equivalent fits the same server (versions + SSE + journal), but
stores one JSON (or Markdown-with-block-ids) document per tab and edits by
block id instead of by text range.
