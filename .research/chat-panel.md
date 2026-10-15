# Chat panel: what is wrong with it and which layout to build

Status: **research**. Nothing here is decided; when a layout is chosen its conclusion moves into `.design/agent-panel.md`. Issue: #83 ("chat panel UX is bad", no solution proposed). No code changed.

Evidence: real-browser screenshots (1280×800, plus 760 wide and en/dark) of every kind through a full run, taken against a production build with the mock model and a stand-in `claude` (the setup of `e2e/run_feed.py`). Files are named `<kind>-1-idle`, `-2-running`, `-3-done`, `-4-history`, `-5-folded`, plus `canvas-narrow-running` and `canvas-en-dark-running`. They live in the project's shared folder `chat-panel/` (not in this repo; screenshots do not belong in the feature branch).

## 1. What the panel is today

One component family for all six kinds (`AgentBar.tsx`, used by `PromptBar.tsx` and `AskClaude.tsx`; `RunFeed.tsx` draws the run). The bar is a fixed-height strip floating at the bottom centre of the stage. The run card and the history list are absolutely positioned above it, up to `min(60vh, 380px)`. The bar folds to a pill. History is a list of the requests of this editor session.

What a person sees, left to right in the bar header: the scope chip ("Whole artboard Team settings"), the context chip ("Continues: <last request>" / "New conversation"), the engine switch (Fast AI / Claude Code; only canvas, slides, motion), the history button, the fold button.

## 2. What I saw, per moment

The issue asks nothing specific, so I walked the four moments of a request.

**Typing a request.** Fine in isolation, crowded around it. The header carries four things on two different axes in one row: *what the request applies to* (scope chip), *where it starts from* (context chip), *who does it* (engine switch) and two tools. At 760 px wide the chips truncate to "整个画板 Team settin…" and "新…" (`canvas-narrow-running.png`). The context chip repeats the previous request word for word.

**Watching a run.** Good: steps fold to the newest one, elapsed time, stop, the artboard being edited gets a "Claude Code is editing" badge (`canvas-en-dark-running.png`). The weak point is where the card sits: it grows upward from the bar and covers the lower 47% of the viewport, which is where the thing being edited usually is (`canvas-3-done`: the half-covered "Connect an agent" artboard; `motion-3-done`: the whole timeline; `dashboard-3-done`: the KPI cards; `design-system-3-done`: the hero; `slides-3-done`: the bottom of the slide). The person watches a spinner and cannot watch the change.

**Reading the answer.** The card stays open after the run, so it keeps covering the result. The only ways out are the ✕ (the answer is gone for good, except what "Keep as note" in #78 saves) or folding the whole bar. There is no way to read the answer and see the result at once, and no way to scroll back to an answer later.

**Going back to earlier requests.** The history button replaces the card with a list (`canvas-4-history.png`). Each row has the prompt, state, time, who and "continues / new". It has no answer, no steps, no files changed, and it is empty after a refresh or a project switch. So "what did it say last time?" has no answer anywhere in the product, and "it continues my last conversation" (which is real: `--resume`) is shown only as a chip, not as a conversation you can read.

Things that work and should stay: the request echoed above the card, folded steps, stop, undo for a whole run, file chips that open the file, the pill that keeps a finished or failed state visible, "Continues / New conversation" being a real resume, Enter while busy keeping what was typed.

## 3. Against Tingly Box's `ux-principles.md`

| # | Principle | Verdict | Why |
|---|---|---|---|
| 1 | Organise around the user's question | partial | The card answers "what is it doing" well. After the run the person's questions are "did it do the right thing" (needs the result in view) and "what did you say" (needs the answer to stay). Neither is served |
| 2 | Eliminate mode pickers | partial | Fast AI / Claude Code is chosen before typing. It is a real difference (seconds vs minutes, one artboard vs the whole project), but the person is asked to pick by model name. A smart default exists (fast for in-place edits, Claude Code for cross-file work) but is not applied |
| 3 | One word, one meaning | partial | "New conversation / Continues" names a Claude Code session; "history" lists requests; "Fast AI" has no conversation at all, so the word "conversation" means different things in two modes. "Chat panel" in the issue is a third word for it |
| 4 | Orthogonal axes | fail | Scope, context and engine are three axes in one row, rendered as three similar-looking chips |
| 5 | Concrete values over aliases | pass | Real file names in steps and chips, the real request text |
| 6 | Smart defaults | pass | Continue the last successful run by default, steps folded by default |
| 7 | Diagnostics on the real path | n/a | |
| 8 | Education in the product | partial | The chip tooltips explain fast AI vs Claude Code; nothing shows what a failed `--resume` means |
| 9 | Less visual noise | fail | Header with five controls, the request text shown three times (echo, context chip, history row), a card as tall as half the screen for a one-line answer |
| 10 | Done is not locked | fail | The answer and steps are lost on ✕, on refresh, on project switch; history keeps only the prompt |
| 11 | Hand over the artifact for the next action | partial | File chips and "Keep as note" (#78) do; the file chip opens a file, which is not the same as showing *where the change is* on the stage (not verified what `onOpen` does per kind) |
| 12 | Scope side effects to the current surface | fail | A transient card from a background run covers the stage the person is working on, in all six kinds |

Four fails and five partials. The three that explain most of the "bad" feeling are 12, 10 and 9, and they share one root: the run's output has no home of its own, so it borrows the stage.

## 4. Layouts

### A. Keep the floating bar, fix the leaks

The structure stays. Changes:

- A finished run collapses by itself to one line above the bar ("✓ Claude Code finished · changed Agents.dc.html · Undo · Show"), so the result is in view. Expanding the answer is one click and is the only time the card is tall.
- The answer, steps and files are stored with each history entry; history rows expand to read them.
- History persisted (server side, per project) so it survives refresh and project switches.
- Context and scope merge into one chip ("Continues the last request · Whole artboard Team settings" becomes one line with a menu); the engine switch gets a default by kind of request.
- The "go to the change" artifact: file chips select the changed artboard / slide / scene.

Cost: small to medium, no new surface, no width taken. Weakness: a long back-and-forth is still not a conversation you can scroll; the floating bar still overlaps the stage bottom; the more is packed into the one-line result, the more it becomes a second card.

### B. Dock the conversation as a side panel (Tingly Box Desk shape)

Desk (`tingly-box/.design/desk.md`) gives a session a fixed place: a transcript of turns, a composer at the bottom, steps and approvals inline. In the editor that is a "Chat" tab in the right panel, which canvas, slides and motion already have (Properties / Code / Tweaks), with the floating bar removed.

- The run output never covers the stage; the transcript is the history, so there is one mechanism, not a card plus a list.
- Long conversations, "what did it say", "which request did that" are all just scrolling.
- Open problems: the right panel is about 310 px and a transcript with steps wants about 360; docs has comments there, dashboards a data-source list, design systems none, so the kinds differ; slides and motion need their width; at phone width the panel is gone. Asking Claude is the main action of the product, and putting it behind a tab makes it an edit mode among three. The prompt bar's hint (set up the model) and the attachment drop zone move with it.

Cost: large (new surface in six layouts, transcript persistence is required, not optional). Weakness: it wins the long-conversation case and loses the common case (one quick request, glance at the result).

### C. Hybrid: floating composer, result chip, dock on demand

Treat the two jobs separately. The **composer** (scope, text, send, attach) stays a small floating bar, as now, minus the context/engine clutter. The **result** is a one-line chip above it (as in A) and a **Conversation view** that holds the full transcript; the chip's "Show" opens it. The view is one component rendered in a container: a popover over the stage's lower edge by default, or pinned as a tab of the right panel by anyone who wants it docked (the choice is remembered, per user, not per kind).

- The common case (type, glance, undo or keep) costs no width and covers nothing.
- The long case has a place: the same transcript, docked.
- One transcript store, one `RunFeed`, one place the answers live, so #78 (Keep as note) and any later "re-run" or "share" attach to the turn, not to a card.
- Persisting the transcript is part of the work, as in B.

Cost: A's work plus the transcript store plus a second container for the same component. Weakness: two ways to see the same thing is a mode picker of its own (principle 2) unless the dock choice is a one-time "pin" action rather than a setting.

### Comparison

| | A fix the leaks | B dock | C hybrid |
|---|---|---|---|
| Result no longer covers the stage | yes (collapsed line) | yes | yes |
| Answer and steps can be read later | yes (history rows) | yes | yes |
| Long conversation has a fixed place | no | yes | yes (pinned) |
| Costs stage width | no | yes | only if pinned |
| Same in all six kinds | yes | needs per-kind right panels | yes (the pinned form needs one) |
| Size | small–medium | large | medium, built in two steps |
| Risk of a second mode | none | none | the pin must be an action, not a setting |

## 5. Recommendation

**Superseded by §5a: dock first, with a switch to the float.** The original reading, **C built as A first**, follows.

**C, built as A first.** The first step is exactly A: collapse the finished run, store answers and steps in history, persist history on the server, merge the chips. It fixes principles 9, 10, 12 on its own and every later layout needs it. The second step adds the pinned conversation tab if people still ask for a long-conversation place after living with A; it reuses the same transcript store and `RunFeed`, so nothing from step one is thrown away. Building B directly would make the quick request, the common one, pay for the long one.

Smaller calls inside the recommendation:

- **Persistence:** keep run history per project on the server (a hidden file next to the project, ignored by write-back and by the bundle, in the style of dashboards' `.runs.json`), not in `localStorage`, so it follows the project across browsers and an embedding host. Open: whether it should be undoable like a file (no) and how long it is kept.
- **Engine switch:** default by the request, not by the person: keep the switch visible only in the bar's overflow menu until a smarter default exists. Open: this changes the AI settings dialog's story ("one dialog, two models").
- **Failed `--resume`:** show it as "the earlier conversation is gone, start a new one" with the request put back, not as a failed run.

## 5a. Direction after the first review (YZ's feedback)

Answers to §7: the card **blocks** the work, it is **hard to interact with**, and fold/unfold is **too extreme** (all or nothing). The leaning is a side panel, with a way to switch between that and the floating bar. That makes the dock the primary form and the float the alternate, so the order in §5 flips: B's surface with C's switch, A's fixes folded in.

Reference: Tingly Box's Desk page (`frontend/src/components/desk/`: `Transcript`, `Trajectory`, `Composer`, `StatusLine`, a sidebar of sessions, an attention dot from `useDeskAttention`). tingly-project itself is not readable from this session (the repo is outside its scope), so this review leans on Desk, which is built from the same pieces; check the layout against tingly-project before building.

Shape:

- **One conversation, two places.** The same transcript and composer render either docked or floating; a button in the panel header moves it. The choice is remembered per user, not per kind, and is an action ("dock" / "float"), not a settings page.
- **Graded, not binary.** Three sizes instead of open/fold: *full* (transcript + composer), *compact* (the latest result as one line + composer, no transcript), *rail* (an icon with an attention dot, as Desk does for sessions waiting on you). The pill becomes the rail; a finished run in compact or rail shows its state without opening anything.
- **Where it docks is the real question**, because the right column is already the inspector (Properties / Code / Tweaks) in canvas, slides and motion:
  1. a tab in that column: no stage width lost, but chat and inspector cannot be seen together (a person editing an element while asking about it needs both);
  2. a new column beside it: both visible, but at 1280 px the stage drops from about 970 to about 610 px, which hurts slides and motion most;
  3. **split the right column vertically**: inspector on top, conversation below with the composer at the bottom; no extra width, both visible, the split is draggable and the conversation collapses to compact. Best fit for the three kinds that already have the column.
  Docs (comments), dashboards (data sources) and design systems (nothing) need their own answer: a column that opens on demand is the simplest, and the matrix in `.design/project-kinds.md` should record it per kind.
- **Interaction fixes that come with it:** the transcript scrolls and keeps every turn (request, steps, answer, files, undo, keep as note), the answer text can be selected and copied, a turn can be re-sent or branched from, and a file chip or step selects what changed on the stage. These answer "hard to interact" directly; most are impossible in a card that disappears.
- **Narrow windows:** below a width threshold the dock cannot exist; it falls back to the float automatically, which is the case for switching that is not a preference.

Still open: whether the split (3) is acceptable at the right column's current 310 px (a transcript with steps wants about 360), and whether the float stays as a permanent second form or only as the narrow-window fallback; a switch that nobody uses is noise (principle 9).

## 6. Interactions with other work

- **Unified import/export menu (#79/#81, group B in the 0545 sweep)** rewrites the canvas status line and bars, not `AgentBar`. Step one does not touch the same files, but the canvas status line sits next to the bar's footprint, so check the bottom margin and the "Synced" position when it lands.
- **#78 Keep as note** puts a button on the run card. In A it moves to the expanded answer; in B/C it belongs to the transcript turn. Whichever lands first, the button should live in `RunFeed`, not in the container.
- **Cross-kind matrix** (`.design/project-kinds.md`): the panel row is ✓ in all six; any change updates it, and the pinned form needs a decision for each kind's right panel.

## 7. Questions for YZ

1. Which moment feels worst: typing, watching a run, reading the answer, or going back? My guess is reading the answer and the card covering the result; the review above is built on it.
2. Is a long conversation a case you want (B/C step two), or are requests mostly one-shot?
3. Is server-side history acceptable (a hidden file per project), or should history stay per browser?
