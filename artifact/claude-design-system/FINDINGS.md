# What the Design System page does (read from its bundle, 2026-10-11)

Sources: grep of `type/app.pretty.js` (line numbers below are in that file), `type/index.html`, `type/run.html`, `type/SKILL.md` and `type/reference/*.md`. Collected from `https://claude.ai/artifact/EpexG3UkrneVrSdA4gpEYf` (type release `1791558544-c1cf`, instance version `1791729959-7a23`). The instance was empty, so there is no sample system. `type/demo.json` is the type's worked example: the "Ember" system as one file table.

## 1. Page UI

- **Empty system:** a start screen with three buttons (94407–94594):
  - "Sync from GitHub"
  - "Build from connectors"
  - "Upload brand files" / "Create design system"

  Each one sends a prepared request to Claude (prompt builders `DC5`/`NC5`, ~80990). The page builds nothing itself.
- **Views:**
  - Overview (98703): cover, then the README brand book
  - Colors (`q97`, 81506)
  - Typography (83630)
  - Spacing and Radius (69490)
  - Shadows
  - Components (88991)
  - Assets (`KM`, 80155)
  - a Files browser ("Design system files", 96705)

  ⌘F searches. A theme switcher ("Themes in this system", 95366) re-themes the live previews.
- **Token editing in place:**
  - Colors: "Add color group" / "Add color" (81908, 82092).
  - Type: "Add type set" / "Add style" / "Upload font" (83645–83768). The font picker offers This system / Font files / Web safe / Google Fonts / Custom… (83091–83114).
  - Shadows: "Add layer" (82278).
  - Every token has "Usage notes" (78542) and a context menu: Rename… / Copy value / Go to target (78432–78483).
  - Validation messages, e.g. "Not a color — try #rrggbb, rgb(), oklch() or {token}." (83867), with matching ones for length, line-height and box-shadow (83882–84239).
- **README editor** (76704–77935): a small rich-text editor.
  - Paragraph/Subheading, bold, italic, link, bulleted and numbered lists.
  - "Markdown shortcuts · select text to format".
  - Placeholder: "Write the brand book here — or ask Claude to." (100370).
- **Assets:**
  - Named "sets": folders under `assets/<Group>/`.
  - A drop zone: "Fonts, logos, images, reference files — folders too" (101153).
  - Per-file Download, and "Ask Claude about this file" (99686).
  - "Free space" deletes unreferenced uploads (75204).
- **Contrast check:** "Fix with Claude" (`HI`, 81012). `AC5` writes the failing pairs per theme into a request.
- **Clean-up:** "Finish the migration" (85292), behind the flag `design_system_clean_up_button` (`vt`, 85291).
- **CI banner:** "Written by a pipeline (…)" when `lastChange.via` starts with "CI" (85057).

## 2. Rendering previews

Each `components/<Comp>/preview.html` card renders like this:

- **Frame:** an iframe with `sandbox="allow-scripts allow-same-origin"` (`TZ7`, 86853; built in `yP5`, 87298) loading `artifact-type/run.html#<token>`.
- **Handoff:** the parent parks `{url, html}` on `window.__dsPreviewRunner` (`OZ7`, 86596).
- **Runner:** `run.html` calls `parent.__dsPreviewRunner.take(token)`, does a `history.replaceState` to the card's own URL, then `document.write`s it. That way relative `../../<path>` and `/_blob/<id>` resolve. At an opaque origin, `run.html` takes the document from `window.name` instead.
- **Injected first:** `tokens.css`, the fonts, `bundle.css`, the libraries and `bundle.js` go in ahead of the card.
- **Card header:** the `<!-- @dsCard … -->` marker is parsed by `O77` (65550).
- **Failures:** a card that navigates away is stopped ("Live preview stopped", 88646). A failure falls back to a "Static preview".

## 3. Loading and saving

- **Storage mode** (`Qy`, 63535):
  - `db` if the capability meta declares `db`
  - `page` if an inline `<script id="appifact-doc">` exists (legacy one-file systems)
  - `files` otherwise
- **Index:** new systems are files. The index is `project/design-system.json` (`n4`, 78929), marked by `createdOnFiles` or `convertedFrom` (72905).
- **Index per type** (`Re`, 92424): Design `project/canvas.json`, Slides `project/deck.json`, Design System `project/design-system.json`.
- **Boot:**
  - list `_files.json` (102169), retrying when the listing is "narrowed";
  - read the index, `tokens.json`, the README and the cards.
- **Migration:** the message "This design system now saves in a newer way…" (94131) covers the move from db or page mode to files (110860–111244).
- **Save:**
  - `window.claude.files.publish(changes, {ifMatch: {path: sha|null}})` (104990, 105400), or `self.publish` / `artifact.publish` (`l$7`, 101403; `JD5`, 63391).
  - Capabilities resolve via `claude.use(name)` (`Vj`, 63301, 45 s timeout), or the legacy `claude[name]`.
  - Error codes (`x57`, 63349): conflict, not_writer, too_large, read_only_path, rate_limited…
- **Generated on save:**
  - `tokens.css`, from `tokens.json` (`kM("tokens.css", I_(tokens,title))`, 100248)
  - `manifest.json`
  - the `api/` cards
- **Save status labels:** "Every change saves automatically" / "Saved automatically" and "Save changes" / "All changes saved" (62391, 100825).
- **Unsaved edits** survive reloads in session storage (`appifact:edits:<path>`, 63689; "Restore unsaved edits", 106209).
- **Conflicts:** a per-file merge dialog with "Theirs", "Hide diff", "Use theirs", "Keep mine" and "Keep mine as a copy" (85575–85698).
- **Other capabilities used:**
  - `room.presence` for live presence (`zt`, 80643)
  - `assets.upload` returning `/_blob/<id>` (`GK`, 63655)
  - `downloads` (90094)
  - `user.canEdit` / `user.can` (63889, 63939)
  - `claude.hot` for hot reload (38062)
- **Comments:** `composer_only` + `customAnchors`.
  - In `page` mode they lived in the doc state (63800–63820, at most 200).
  - A comment sent to Claude reports "Sent to Claude — it will reply in the comment thread" (`KS5`, 98789).

## 4. Talking to Claude

- **Sending:** `Kb` (80790) tries `room.canSendToClaudeSession()` / `room.sendToClaudeSession({label, selectedText, request}, {deliver:"send"})` (`Gb`/`O17`, 80724).
  - The request is capped at 2000 characters and the selection at 1800.
  - The page then reports "Sent to Claude." or "Added to your message to Claude." (`dV`, 95005).
- **No session answers:** `KC5` (80716) falls back to `claude.chat.suggestPrompt(prompt)`, then to the clipboard ("Prompt copied. Paste it to Claude.").
- **Who does the work:** Claude does all model-side work (building from GitHub, connectors or uploads; covers; migrations) by following `SKILL.md`. There is no in-page model: the page has no `sample` capability.
