# Tingly Design

A design editor with two-way editing: canvases, slides, design systems, dashboards, docs and motion pieces are plain files under `projects/<name>/`, edited by hand in the editor, by a fast model, by Claude Code, or in a terminal, all through one write-back engine. It runs alone or embedded in Tingly Box.

Start with `docs/en/architecture.md` for how it works and the repository layout.

# Guideline

Tingly Design ships inside Tingly Box and follows the same working conventions as the Tingly Box repository (its `CLAUDE.md` and `.design/`). When this file is silent, do what Tingly Box does.

## UX-First (highest priority)

The product is the core; **UX always comes first**. When UX conflicts with implementation convenience, push UX further rather than diluting it.

**Before building a new feature or changing an existing one, read Tingly Box's [`.design/ux-principles.md`](https://github.com/tingly-dev/tingly-box/blob/main/.design/ux-principles.md).** Its 12 criteria (organize around the user's question; eliminate mode pickers; one word, one meaning; separate orthogonal axes; concrete values over aliases; smart defaults over toggles; diagnostics on the real path; education inside the product; less visual noise; done ≠ locked; hand over the artifact for the next action; scope side effects to the current surface) end in a checklist. Check new features and PRs against it; a deviation needs a stated reason. Editor copy is Chinese.

## Frontend

- Icons are Tabler (`@tabler/icons-react`); prefer the shared set in `apps/editor/src/components/icons.tsx` and add new ones there when they are reused.
- The editor's look is theme tokens (`apps/editor/src/theme.ts`, synced from Tingly Box's `@tingly/ui` palettes by `scripts/sync-tingly-box-theme.mjs`); use tokens, not raw colours, in editor chrome. Work inside canvases, slides and dashboards keeps its own colours.

# Keep these in sync (read this before every change)

Three things drift silently when a session forgets them. Each PR that touches one of them updates it in the same PR, not in a follow-up.

## 1. This file

Update `CLAUDE.md` when a PR adds a project kind, a package or app, a cross-kind feature, a convention, a test suite, or a doc that future sessions must read first. If you had to discover something by reading code that a new session would need on day one, it belongs here or in a doc linked from here.

## 2. `.design/`

`.design/` holds the design notes: why a subsystem looks the way it is, the options weighed, what was decided and what is still open. `.design/README.md` is the index, with a row per note grouped by topic.

- **Before** building a feature or changing a subsystem, read the index and the notes it points to.
- **With** each PR whose core is a new feature, a new project kind, a new file format, a protocol or a non-obvious trade-off, write a note or update the existing one, and its row in the index. A bug fix, a rename or copy change usually needs none; say so in the PR if you skip it.
- Follow the maintenance rules at the top of `.design/README.md` (the same as Tingly Box's): current contract, implementation status, history and proposals kept apart; diagrams in a separate `<topic>.pencil.md`; renames update every reference.
- A note describes the design and the reasoning: the problem, the options weighed, what was decided and why, what is still open. It is not a changelog: no PR numbers, commit hashes or "in this PR we…"; that belongs in git history and the PR description. When the design changes, rewrite the note to the current design instead of appending an entry.
- A note says its status on the first line after the title (`方案` / `研究` / `已实施` …). Keep implemented facts, proposals and history apart.
- `docs/` is the other half: user guides (`docs/*/guide/`) and how-it-works pages (`architecture`, `theming`, `embedding`, `development`). Those are written in both `docs/en/` and `docs/zh/`; change both. `.design/` notes are written once, in either language.

## 3. Features that span project kinds

Most editor features are not "canvas features": the prompt bar, attachments, themes, the journal and undo, host messages, export, the launcher card, Claude Code delegation all have to work in every kind. Every kind, motion included, has to plug into every one of them, and so does any kind added later.

**Read `.design/project-kinds.md` before adding a kind or a feature that any kind can reach.** It lists every place a kind is registered (core, server, editor, launcher, skills, samples, docs, e2e) and a matrix of which cross-kind features each kind supports, with the known gaps. When you change either, update the matrix in the same PR. When a feature deliberately skips a kind, write that down in the matrix with the reason, so the next session knows it is a choice and not an omission.

Rules of thumb:

- Build a cross-kind feature once, in a shared component or module (`PromptBar`, `AskClaude`, `attachments.ts`, `host.ts`, `theme.ts`), and wire it into every kind's app. Don't copy it per kind.
- Anything a feature tells Claude Code about a kind (paths, what a file may reference) also goes into that kind's skill under `.claude/skills/<kind>/SKILL.md` and its system prompt in `apps/server/src/delegate.ts`.
- Test it in each kind it claims to support, or say in the PR which kinds were not tested.

# Layout

```
packages/core     formats, write-back, prompts, per-kind logic (canvas, deck, designSystem, dash, docs, motion, attachments, launcher)
packages/sandbox  artboard / dashboard / motion runtimes and the AI executor, as IIFEs
packages/import   HTML and SVG → canvas importer (see .design/import-external-material.md)
apps/server       Hono server: files with versions, SSE, journal, fast AI proxy, Claude Code delegation
apps/editor       React editors, one app per kind under components/<kind>/, the launcher, shared bars
projects/         sample projects, one per kind
.claude/skills/   format references Claude Code reads before every delegated task, one per kind
.design/          design notes (index in .design/README.md)
docs/en, docs/zh  guides and how-it-works pages, both languages
e2e/              Playwright suites per kind and per cross-kind feature, a mock model
artifact/         private reference material; never publish
```

# Build and test

```bash
pnpm dev            # server + editor
pnpm test           # core unit tests
pnpm typecheck
pnpm build
pnpm bundle         # dist/tingly-design/, the folder a host ships
```

End-to-end suites are listed in `docs/en/development.md` (one per kind, plus `launcher`, `theme`, `embed`, `attach`, `fast`, `fast_slides`, `delegate`); add new suites to both language versions of that table.

# Pull requests

Follow `.github/pull_request_template.md` (the same as Tingly Box's) for PR title and description. The title is `type(scope): what changed`. The description starts at `## Summary` with no header above it, then `## Key Changes`, within the template's length caps. Everything that is not about the change (requester, thread / session links, hidden markers) goes in a short, plain footer after a `---` rule; no badges, banners or "Generated with" lines.

- Screenshots go to the `pr-assets` branch, not into the feature branch.
- Say in the description which `.design/` note and which `CLAUDE.md` section the PR updated, or why none was needed.
