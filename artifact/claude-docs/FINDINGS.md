# What the Docs viewer does (read from its bundles, 2026-10-11)

## Sources

- `type/app-core-BV3j7AqY.pretty.js` (A), `type/index-CM7wmSU0.pretty.js` (I) and `type/app-lazy-wWvIy5_q.pretty.js` (L), read by grep. Line numbers below are in these files.
- `type/hello-early-Disx_30T.js` (minified).
- `type/SKILL.md`.
- The Claude Docs connector's own `guide` (topic.index, topic.editing), for the block model.

Collected from `https://claude.ai/artifact/MWUypNpk4Rp4gMT9SLwy1w` (type release `1791658616-c881`, instance version `1791729961-a87b`). The instance holds no doc. To save space, only the four bundles cited here have prettified copies.

## 1. Where content lives

- **Not in files.** A doc lives in the Claude Docs service (internally "bongo", app key `pages`), keyed by the artifact id.
- **Claude writes through the connector.** The Docs MCP connector's `batch`, `update`, `read`, `query` and `create` are the only way in. Publishing files changes nothing.
- **Capabilities** (from the `index.html` meta): `user`, `assets`, `sample`, `room`, `downloads`, `comments {customAnchors, headless}`. `mcp` covers export tools only.

## 2. How the viewer reaches the service

The page never calls the service itself. It talks to the Frame shell (its parent window) over postMessage.

- **Message names.** Every message is prefixed `frame-sync:` and carries `store: "bongo"` (hello-early: `S="bongo"`, `C="frame-sync:"`).
  - Viewer to shell: `hello`, `open {stream, spec, since}`, `since`, `send {stream, seq, payload}`, `close`.
  - Shell to viewer: `state {connected, sendable}`, `opened`, `frame`, `ack`, `refused`, `result`, `reset`, `unavailable`.
- **Shell origin.** It is either "stated" in `__FRAME_PREAMBLE` or "asked" from a list.
- **Lanes.** `By` (A:36784) multiplexes up to 16 lanes (`bongo.N`), keyed by address, e.g. `project/<id>`.
  - `mAe` (A:36735) dispatches incoming messages.
  - Hello is retried 3 times; `revoked` and `no_relay` are terminal.
- **REST over a lane.** `frameDoor`/`kAe` (A:38522) carries REST-shaped calls: `/api/<c>/ops`, `/versions`, `/proposals/<id>/merge`, `/acl`, `/duplicate`, `/metadata`, `/restore` (A:64416–64814).
- **Offline safety.** Unsent ops and comments are kept in IndexedDB (`qR`, A:61990: `bongo.op-wal`, `bongo.comment-outbox`).

## 3. Block model

- **Editor.** A TipTap/ProseMirror tree (`pm-schema-*.js`).
- **Block types.** paragraph, heading, blockquote, bulletList, orderedList, taskList/taskItem, codeBlock (latex, csv and markdown render specially), table/row/cell.
- **Marks.** bold, italic, underline, strike, code, highlight, link.
- **Plugins.** commentAnchor, emoji typeahead, artifact link chips.
- **Chips.** Inline atoms for mention, date, dropdown (backed by a doc-level enum) and embed (a widget node).
- **Pending blocks.** `pending` blocks carry an `intent` until Claude replaces them.
- **Tabs.** A doc holds tabs ("files", which can nest). Each tab's body is a `node` with engine `prose`.
- **Ids and revisions.**
  - Blocks have ids `<session>.<clock>` and an 8-hex hash `h`.
  - Writes are guarded with `ifHash` / `ifRev`.
  - Every read and write returns the tab's `rev`.
- **Widgets.**
  - TSX modules rendered by the lfile runtime (`lfile-runtime.*.js`), inside a hidden `sandbox="allow-scripts"` srcdoc iframe (`oft`, A:87806; `xxt`, A:95644).
  - `claude.Visualize` charts are drawn from `sources`.
  - The in-page widget writer's prompt starts at I:22740.

## 4. UI

- **Insert menu** (slash, I:20040–20100): Paragraph, Heading 1–n, Bulleted, Numbered, Checklist, Code block, Date, Divider, Dropdown, Quote, Table.
- **Spark menu:** "Make it shorter", "Fix spelling and grammar" (I:19835).
- **Proofreading:** "Suggestions from Claude", behind the `proofreadClaude` flag (I:33331).
- **Tabs panel:** add a tab or subtab, move tabs in and out, restore deleted tabs.
- **Settings:**
  - font: serif or sans, set for headings and text separately;
  - layout width: default or wide;
  - document language.
- **Version history:** restore, compare, "Show changes".
- **Drafts:** "Insert as draft" / "Name new draft", built on proposals.
- **Comments:** floating, or in a right rail; filter, resolve and reactions.
- **Other:** presence ("Someone is in this document"), keyboard shortcuts, and the error "Can't reach Claude Docs" (I:52058).

## 5. Talking to Claude

- **View context.** `LYe` (A:61844) publishes `{mode, tab, node, selected, range, dirty, rev, edits}` through `room.presence({context})` (`FYe`, A:61829).
  - Updates are debounced by 500 ms.
  - `edits` is kept in session storage under `bongo.viewerEdits.<id>`.
  - This is the `<artifact-view-context>` block Claude receives.
- **Comment to Claude.** `comments.sendToClaude({anchor:{path,x,y}, text})` (`Kye`, A:25901; `dh` resolves `use("comments")`, A:25617).
  - The anchor path is `f-<tab>#<node>/<block>;thread=<root>`.
  - The platform's comment thread is only a relay. Claude answers in the doc's own utterance thread.
- **"@Claude" at an empty line.** `Dm` (L:7900) builds `{label, request, instruction, tab, nodeId, blockId}` (≤4 KB) and sends it with `room.sendToClaudeSession(bag, {deliver:"send"})` (L:7724–7790).
  - Claude receives it as the `[Sent to Claude from an artifact's page]` PAGE DATA turn.
  - The answer is written into the doc at that block.
- **"Ask Claude…".** `sbe` (A:25987) posts `frame-context:card {text, ref:{id,path}, kind, title}` to the shell, which adds it to the chat composer ("Added to your message to Claude").
- **In-page model.** `claude.use("sample")` (`MJe`, A:60821) is used for proofreading and widget writing, for members only.

## 6. Export

- **Downloads:** "Export as Word (.docx)", "PDF (.pdf)", "Markdown (.md)".
- **Google Docs:** through the declared MCP tools `Claude Docs.export` and `Google Drive.create_file` / `gdrive_upload` (`aGe`, A:58965).
- **Notion:** through `notion-create-pages`, with consent prompts.
- **Pieces of a doc:** tables download as CSV or Markdown; diagrams as PNG, SVG or MMD.
