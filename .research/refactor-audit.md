# Codebase audit and staged refactor plan

Status: 研究 (findings 2026-10-22; baseline: `pnpm typecheck` and `pnpm test` green on main)

Starting point is the architecture overview (`docs/*/architecture.md`). This note records what an automated and manual pass found, and the order in which the cleanup runs. Every step is behaviour-preserving, small, and ships as its own PR with e2e (`DC_CHROME` headless shell) green.

## Size and shape

About 68k lines of TS/TSX/CSS (hand-written, data files excluded): editor 32k, core 18k, server 6k, i18n 5.5k, sandbox 3.5k, export 2.3k, import 2.3k. 715 tracked files. Only 4 `as any`/`@ts-ignore`, 0 TODO/FIXME. Duplication is very low (jscpd: 12 small clones, 0.03%). The code is healthier than its size suggests; the work is boundaries and a few oversized modules, not a rewrite.

## Findings

### A. Dead code and unused dependencies (knip)
- 45 unused exports and 31 unused exported types, mostly in `apps/editor` (`theme.ts`, `store.ts`, `fastedit.ts`, `host.ts`, `i18n.ts`, palettes under `tingly-box/`) and `apps/server` (`render.ts`, `pageExport.ts`, `commands.ts`, `store.ts`).
- `@floating-ui/dom` in `apps/editor` is not imported anywhere.
- knip needs its entries configured (sandbox IIFEs are built by esbuild, `scripts/*.mjs` are entries) before it can gate CI; with that, its "unused files" list is mostly false positives, and the sandbox "unused dependencies" are false positives too (d3 is used by `sandbox/src/dash.ts`).
- Candidate: wire `knip` into CI with a config (reuse the library instead of a homegrown script).

### B. Oversized modules
- `apps/server/src/app.ts` (1010 lines, ~50 routes) holds design systems, import-from-project, assets, dashboards, fast edit, AI settings, images, delegate, render, git and MCP routes in one file, already divided by banner comments. Split into per-area Hono sub-apps mounted by `app.ts`.
- `apps/server/src/commands.ts` (763): command data, option types and per-kind `switch`es together.
- `packages/sandbox/src/runtime.tsx` (1488): template renderer, selection overlay, drag, resize, snapping and message handling in one IIFE source. Split into modules; esbuild still emits one IIFE.
- `apps/editor/src/store.ts` (759, 41 exports): shared by every kind; split by concern (files/sync, selection, history, pending edits).
- `packages/core`: `pptx.ts` (1179), `pptxChart.ts` (1336), `designSystem.ts` (817), `motion.ts` (788) are cohesive and covered by tests; leave unless touched. `core/src/index.ts` is a single barrel (104 imports from `@dc/core` in apps).
- CSS: `launcher.css` 1869 lines, `design-system.css` 1124, `panel.css` 989, `motion.css` 925. Split launcher.css by surface (cards, New dialog, import) at the same cascade position.

### C. Duplication (jscpd, 12 clones)
- Chrome launch/page plumbing repeated in `server/render.ts`, `pdf.ts`, `pageExport.ts` (5 clones): extract one `chrome.ts` helper (launch, wait, timeout, cleanup).
- Editor: `canvas/Board.tsx` (2), `RunFeed.tsx`, `motion/Timeline.tsx` vs `MotionPanel.tsx`: small shared pieces.
- `packages/import/src/cli.ts` (2).

### D. Boundaries
- Package direction is clean: core, i18n, export import nothing from apps; import depends on core and i18n; sandbox on core and export; editor/server on core. Nothing enforces this. Candidate: `dependency-cruiser` rule set in CI (reuse), mirroring the table in `architecture.md`.
- Kind registration is spread over core, server, editor, launcher, skills, samples, docs and e2e (`.design/project-kinds.md`). Server-side kind `switch`es are few (3 in `commands.ts`); the editor's six `*App.tsx` (57 to 420 lines) repeat the same shell wiring (TopBar, ChatShell, FileMenu, request bar, side columns). A `KindShell` / registry that each kind fills in would shrink them and make the matrix in `project-kinds.md` mechanical. This one needs design before code.
- Server logging: `console.*` only in `serve.ts` (ready line) and `cli.ts` (command output): intentional.

### E. Docs and project instructions
- `CLAUDE.md` has grown into long run-on paragraphs (PPTX, Claude Design, imports). Move detail into the matching `.design/` notes and keep CLAUDE.md as pointers plus the sync rules.

## Staged plan

1. Dead code and deps: remove unused exports/types/dependency, add knip config + CI step. (low risk)
2. Server: extract `chrome.ts`, split `app.ts` into route modules, trim `commands.ts`. (low to medium)
3. Editor shared: split `store.ts`; dedupe Board/RunFeed/Timeline clones; split big CSS files. (medium)
4. Sandbox `runtime.tsx` split into modules. (medium, covered by every kind's e2e)
5. Boundaries: dependency-cruiser rules in CI; `core` barrel subpath exports if it pays off. (low)
6. Kind shell: design note first, then migrate kinds one by one. (needs YZ's call on scope)
7. CLAUDE.md slimming and doc sync after each step; refresh `architecture.md` when module layout changes.

## Not doing
- No rewrite of pptx/chart modules, no change to file formats, no feature removal.
