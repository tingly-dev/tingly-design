# Editor UI components: what to tidy and in which order

Status: **research**. Nothing here is decided and no code changed. When a step lands, what it settles (a shared primitive, a folder rule) moves into `.design/` and `CLAUDE.md`.

Scope: `apps/editor/src` at the time of writing (≈19 000 lines of TS/TSX, one 6 542-line `styles.css`). Inputs: line counts, greps for repeated patterns, the six kinds' `*App.tsx`, and the yellow "Open" boxes on the boards of `projects/tingly-design-ui-canvas`.

## 1. What is in good shape

- Cross-kind pieces already exist and are used: `TopBar` + `ProjectTitle` + `BarButton`, `FileMenu`, `Menu` / `MenuItem`, `RunFeed`, `AgentBar` (dock, history, pill), `Attachments`, `JournalPopover`, `RightPanel`.
- Theme is tokens: `styles.css` has 883 `var(--…)` uses; the 94 raw colours are almost all token definitions at the top of the file.
- Strings are i18n keys, icons go through `components/icons.tsx`.

So this is tidying, not a rewrite. The work below is about duplication that has already crept in, files that grew past what one person reads at once, and a folder layout that no longer says what is shared.

## 2. Findings

### 2.1 Two request bars that are mostly one

`PromptBar.tsx` (242 lines: canvas, slides, motion) and `AskClaude.tsx` (141 lines: design system, dashboard, docs) share 82 non-trivial lines: the same text box, auto-grow, attachments, dock hooks, history list, send/stop, run feed. The difference is that `PromptBar` also offers Fast AI and a target chip. Every fix to the bar (the dock, the folded card, attachments) has to be made twice, and the AgentBar board's open question ("should Fast AI work on a doc passage?") is harder to try because the second bar has no slot for it.

### 2.2 Seven dialogs, seven hand-rolled modals

`className="lmodal"` with `onMouseDown={(e) => e.target === e.currentTarget && onClose()}` is copied in `AiSettings`, `Launcher` (New, Open a folder), `Overlays` (Commit), `VideoExportDialog`, `ImportDialog`, `BoardPicker`. Each re-does Escape on its own; none sets `aria-modal`, none keeps Tab inside the dialog, and three of them never move focus into the dialog. One `Dialog` component (backdrop, Escape, initial focus, focus trap, return focus, `role="dialog" aria-modal`) fixes the keyboard behaviour everywhere at once.

### 2.3 Small helpers copied per file

- `download()` four times (`Board.tsx`, `DocsApp.tsx`, `dash/Sources.tsx`, `slides/exportDeck.tsx`).
- Element-size hooks over `ResizeObserver` three times under three names (`useWidth` in Launcher, `useBox` in MotionApp, `useFit` in SlidesApp), plus raw observers in `Canvas` and `Overlays`.
- Guarded `localStorage` read/write (`stored` / `store` in Launcher) re-done in `store.ts`, `theme.ts`, `i18n.ts`, `dash.ts`, `docs.ts`, `motionSizes.ts`.

### 2.4 The top bar: same buttons, written per kind

- The right-panel toggle is the same `<button className="tb" aria-pressed …><Panel/></button>` in canvas, slides and motion; it belongs to `TopBar` as a prop.
- Motion's title is a bare `<span className="dashtitle">`: the only kind whose name cannot be renamed from the top bar.
- Design system's Import / Export is not the ⇄ icon the other five use (its board's open note).

### 2.5 Files past one screen of thought

| file | lines | what is inside |
| --- | --- | --- |
| `components/Launcher.tsx` | 1 151 | the page, cards, rows, live previews, minimap, project menu, New dialog, Open-a-folder dialog |
| `store.ts` | 837 | canvas state, selection, journal, runs and their undo, bar state, toasts |
| `components/motion/MotionApp.tsx` | 695 | one function of ~600 lines: top bar, stage, timeline, speed, notes |
| `components/panel/ElementProps.tsx` | 552 | every element property section plus SVG look |
| `components/slides/SlidesApp.tsx` | 531 | strip, stage, top bar, presenting, notes, issues |
| `styles.css` | 6 542 | every area of every kind, in one file, in the order things were added |

### 2.6 The folder no longer says what is shared

`components/` mixes cross-kind pieces (`TopBar`, `FileMenu`, `PromptBar`, `AgentBar`, `RunFeed`, `Menu`) with canvas-only ones (`Board`, `Canvas`, `Item`, `Overlays`, `Bars`, `BoardPicker`). The other five kinds have their own folders; the canvas does not. Per-kind state (`slides.ts`, `motion.ts`, `dash.ts`, `docs.ts`, `ds.ts`) sits in `src/` next to cross-kind modules. A new session cannot tell from the tree which files a feature must touch for all six kinds, which is the drift `CLAUDE.md` warns about.

### 2.7 Button classes

Buttons are `btn` (67), `tb` (28, top bar), `ib` (28, icon button) plus ~25 one-off classes. That split is reasonable; the one-offs (`ibtn` in slide issues next to `ib`, `tokbtn`, `lmore`, `vmore` …) are where looks drift. Worth a pass only after the CSS is split (2.5), so each one-off is seen next to its area. Done after the split: the attachment chip's remove button and the canvas board strip's buttons were icon buttons rebuilt from scratch and are now `ib` with only their size, radius and colour kept; the rest (`ibtn` the issues pill, `tokbtn` / `vmore` text links, `lmore` the floating card menu, `mcoverx`, `tw`, the docs toolbar) are different roles and stay.

## 3. Plan: small PRs, each green and shippable alone

Order is by value over risk. Steps 1–4 are behaviour-preserving or small visible fixes; 5–7 are pure moves that touch many files and should wait until open editor PRs (image generation, keep an answer as a note) are merged, to avoid conflicts.

1. **`Dialog` primitive** (2.2). New `components/Dialog.tsx`; the seven dialogs move onto it. Visible change: focus lands in the dialog, Tab stays in it, Esc works the same everywhere. Tested by the `launcher`, `ai_settings`, `git`, `export`, `import_board` e2e suites. Screenshots of each dialog, light/dark, en/zh.
2. **Shared hooks and helpers** (2.3). `useElementSize`, `download`, `localPref` in one module; no visible change, no screenshots.
3. **One request bar** (2.1). `AskClaude` becomes `PromptBar` with Fast AI and the target chip as optional slots; the six kinds keep exactly what they show today. Tested by `fast`, `fast_slides`, `fast_motion`, `delegate`, `dock`, `run_feed`, `attach` in every kind. Screenshots of the bar in all six kinds.
4. **Top bar tidy** (2.4). `TopBar` takes the panel toggle; motion gets `ProjectTitle`; design system uses the ⇄ `FileMenu`. Redraws the Shell, Motion and DesignSystem boards. Screenshots of six top bars.
5. **Folders** (2.6). `components/shared/` (or `shell/`) for cross-kind pieces, `components/canvas/` for canvas-only ones, per-kind state next to its components. Pure `git mv` + import paths; `CLAUDE.md` layout and `.design/project-kinds.md` registration list updated.
6. **Split the big files** (2.5), one PR each: Launcher (page / card+preview / dialogs), MotionApp (top bar / stage / timeline), SlidesApp (strip / stage / present), `store.ts` into slices. No visible change.
7. **Split `styles.css`** (done: `styles/<area>.css`, imported in cascade order) per area (shell, menus, dialogs, panel, agent bar, launcher, one per kind), imported in today's order so the cascade is unchanged; then the one-off button pass (2.7).

Recommendation: start with **1 (Dialog)**. It is small, it is the only finding that is also a real keyboard/accessibility bug, and it gives the later steps a primitive to build on. Step 3 has the most long-term value but the widest test surface; do it second or third.

## 4. Open questions

- Folder names for step 5: `components/shared/` + `components/canvas/`, or keep shared pieces at `components/` root and only move the canvas into its own folder (smaller diff)?
- Should step 3 also give the doc, dashboard and design system a Fast AI slot (AgentBar board's open question), or stay a pure merge first?
- `styles.css` split: plain CSS files per area (no tooling change), or CSS modules (scoped names, bigger change)? Plain files are proposed.
