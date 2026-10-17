# Harness: how Tingly Design verifies that it works

Status: **research, under discussion** (nothing built beyond what already exists). Raised by YZ: most of the product is interaction and visuals, not model calls, and even where a model is involved "correct" is hard to define. "Harness" is the working name for all validation, matching `cli/harness` in Tingly Box. Once a direction is picked, the conclusion moves into `.design/`.

## 1. What exists today

| Layer | What | Runs in CI? |
|---|---|---|
| Unit tests (`pnpm test`) | core formats, write-back, checkers (`checkCanvas`, `checkSlide`, `checkScene`), i18n key parity, exporter capabilities | yes |
| Typecheck, bundle, bundle smoke | `ci.yml` | yes |
| E2E (`e2e/*.py`, 30 suites) | Playwright against `pnpm dev` / a built server, DOM assertions per kind and per cross-kind feature, a mock Anthropic server and a stand-in `claude` | **no**, run by hand; one known failure on main (#159) |
| `check` / `check --snapshots` | project-level lint, then each board / slide / tab / cover drawn by the machine's Chrome; unrenderable counts as an error, images kept for an agent to look at | no |
| `prompt` / `prompt --fast`, MCP | an agent can drive the editor and read the result | no |
| `e2e/delegate.py` | the real `claude` CLI | no |

So the base is wide, but three things are missing: (1) the e2e layer is not a gate, (2) nothing judges how a result *looks* (a drawn snapshot only proves it drew), (3) nothing measures model-involved behaviour as a quality, only as pass/fail with a mock.

Tingly Box already has a mature harness (`cli/harness`, `.design/harness-matrix.md`, `harness-duo.md`, `harness-agent-testing.md`; VModel as the deterministic virtual upstream, `vmodel-sequence` for temporal failures such as `200, 200, 429, 200`). We should reuse its vocabulary (tiers, `--mock` vs real, a summary table plus artifacts), not invent a second one.

## 2. The question to answer per feature: what is the oracle?

Every check needs something that says "this is right". The features fall in four groups by what that thing can be.

| Group | Examples | Oracle | Mechanism |
|---|---|---|---|
| A. Deterministic logic | parse and write-back, undo, journal, archive, git, folders, CLI | exact expected value | unit + e2e (have it) |
| B. Interaction | select, drag, resize, retype, dock, dialogs and keyboard | DOM / file state after the gesture | e2e (have it; make it a gate) |
| C. Appearance | layout, theme tokens, both languages, a slide or board "looks right" | a stored baseline, or a written expectation | see 3 |
| D. Model-involved | fast AI edit, Claude Code run, skills | a *property* of the result, not its text | see 4 |

## 3. Appearance (C)

Options weighed:

1. **Golden screenshots with pixel diff.** Cheap and catches regressions, but brittle (fonts, antialiasing, Chrome version) and says nothing about whether the baseline was good. Pin the browser (`chromium_headless_shell`, already required for e2e), a fixed viewport and fonts; compare with a tolerance and a per-region mask for live content.
2. **Structural assertions** (computed style, bounding boxes: nothing overflows, text fits, contrast of tokens). Robust, no baseline; limited to what we think to assert. The canvas checker is this for files; the same idea fits the rendered DOM.
3. **The editor's own design canvas as the spec.** `projects/tingly-design-ui` already draws the intended UI per board. A check could render a board and the real screen and compare coarse layout (regions, order, presence of named controls), not pixels. Worth a spike; the risk is the boards drifting from reality, which the CLAUDE.md rule against that already tries to prevent.
4. **Vision model as judge.** Give a snapshot plus a short rubric ("title fits, nothing clipped, contrast readable, matches the request") and get a scored verdict. Useful for generated *content* (a slide an AI made) where no baseline exists. Noisy, so it scores and flags; it never gates a merge alone.

Proposal: 1 for the editor chrome per kind × light/dark × en/zh (the matrix PR screenshots already require), 2 for overflow and contrast on every `check --snapshots` image, 4 only for generated content in group D.

## 4. Model-involved behaviour (D)

Split the model's role first.

- **Model as the thing under test** (does the fast AI / Claude Code do a good job). The answer is non-deterministic, so judge properties: the result passes the kind's checker (`checkSlide` etc.), stays inside the closed subset, touches only intended files, undo restores the exact prior bytes, and a vision judge says it meets the request. Report a pass rate over a fixed prompt set, not one green/red.
- **Model as a fault source** (does the product survive a bad model). Fully deterministic with a scripted model: truncated stream, 429 in the middle, a reply with a throwing statement, a reply that leaves the subset, a very slow stream, cancel mid-run. The mock in `e2e/mock_anthropic.py` already does one of these. This is where **VModel fits**: a sequence of outcomes (`200, 429, 200`) and scripted replies, served on the Anthropic protocol, so e2e needs no ad hoc mock per suite. The ask for VModel is a "scripted reply" model (reply text per turn, per request match) beside the existing sequence of statuses.
- **Model as the author of a project** (can an agent using our skills and MCP tools build a valid project). A task suite: prompt → agent runs with the skill → `check --snapshots` passes → judge scores. This is the same shape as Tingly Box's agent harness (real CLI against the gateway, mock mode for smoke, real mode for the scan).

VModel's future custom orchestration would let one scenario script both the replies and the faults (for example "second turn fails, third succeeds") so retry and recovery paths in the editor are tested without a real provider.

## 5. One runner, tiers, one report

A single entry (working name `pnpm harness`, later maybe `tingly-design verify`) that runs tiers and writes one report with the images attached:

| Tier | Contents | When | Gate |
|---|---|---|---|
| T0 | unit, typecheck, bundle smoke | every PR | yes (today) |
| T1 | hermetic e2e with scripted model, all kinds | every PR | yes (new) |
| T2 | visual: baselines + structural checks on snapshots | every PR touching the editor | yes for structure, review for diffs |
| T3 | real model and real agent evals, vision judge | nightly / on demand | no, scored and trended |

Plus a **coverage check on the cross-kind matrix**: `.design/project-kinds.md` lists which kind supports which cross-kind feature. Make the matrix data, and fail when a claimed cell has no e2e behind it. This turns "check it in each kind" from a reminder into a test.

## 6. Scope decision: no outside dependencies first

Decided with YZ: plan only what needs no real model and no Tingly Box (T0 to T2). T3, VModel and the vision judge are parked until this part works; the scripted mock in `e2e/mock_anthropic.py` and the stand-in `claude` already cover the fault cases we need.

Steps, each small and independently useful:

1. **Make the e2e suites runnable as one command.** `pnpm e2e` starts what each suite needs (server, mock model, stand-in `claude`, pinned `chromium_headless_shell`), runs all suites, prints one table (suite, checks, pass/fail, time) and keeps failure screenshots. Today each suite has its own startup recipe in `docs/en/development.md`.
2. **Fix the known failure (#159), then add e2e to CI** as a separate job from the fast unit job, so a red e2e is visible without slowing the unit feedback.
3. **Structural checks on snapshots**: inside `check --snapshots`, assert on the rendered page (no overflow or clipped text, contrast of text on its background, a board that draws something non-blank). No baselines yet.
4. **Screenshot baselines for the editor chrome**: one image per kind × light/dark × en/zh at a fixed viewport, compared with a tolerance; a diff is reviewed and re-recorded with one command, never auto-accepted.
5. **Cross-kind matrix as data**: `.design/project-kinds.md` stays the readable table, a small JSON next to it lists feature × kind with the suite that covers each cell, and a unit test fails on a claimed cell with no suite (or a suite naming a cell that is not claimed).

Out of scope for now: real-model evals, vision judge, VModel scripting, a public `verify` command, the design-canvas-as-spec comparison.

## 7. Open questions for YZ

1. Is e2e as a required CI check acceptable (a few minutes of Playwright per PR)?
2. Baselines: stored in the repo (simple, grows the repo) or on the `pr-assets`-style side branch?
3. Order: is 1 → 2 → 3 → 4 → 5 right, or should the matrix check (5) come first because it is cheap?
