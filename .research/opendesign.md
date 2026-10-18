# OpenDesign: its motion support, and how it manages design systems, themes, templates and effect libraries

Status: **research, partly decided** (October 2026). Decided with the owner: Tingly Design does not bundle OpenDesign's brand packages or build a catalog; `DESIGN.md` is supported as an **import** (and possibly a derived export) into our own design system, which stays the source of truth; the motion taste contract (§1.6 item 1) goes ahead and is designed in [`.design/motion-taste.md`](../.design/motion-taste.md); the other items below are deferred, not rejected. Two questions: (1) what does the newest OpenDesign do for motion, and (2) how does it organize design systems, themes, styles, templates and effect libraries so that a new user gets a good result fast. Each part ends with what Tingly Design could borrow. Nothing here is built; once a direction is picked, its conclusion moves into `.design/` and this note is marked decided.

**Sources and limits.** Read: the repository README, the v0.25.0 release page and PR #8619 (motion), `skills/motion-design/SKILL.md`, `design-systems/README.md`, the changelog, the `motion-anything` README and `MOTION-SPEC.md`, HyperFrames' overview and registry pages. Not readable: GitHub directory listings (`robots.txt`), so folder contents are taken from the READMEs, not from the trees. Counts in the project's own pages disagree with each other (agents 25 vs 26, plugins 261 vs 277, recipes 403 vs "200+"); numbers below are the README's and are marketing-grade. Nothing was installed or run. "OpenDesign" is `nexu-io/open-design` (Apache-2.0); [`motion.md`](../.design/motion.md) §3.1 describes it as it was before this release (no motion of its own, delegating to HyperFrames); that picture is now partly out of date.

## 0. What OpenDesign is

A local-first workspace where a coding agent (27 runtime definitions, 26 executables, or a BYOK proxy) is the design engine and writes real files into a project folder. A Next.js app plus an Express/SQLite daemon; desktop shells for macOS and Windows; an MCP server; a `od` CLI. Its content is organized as **repo folders of files an agent reads**: `skills/` (100+, `SKILL.md`), `design-templates/` (renderable starters), `design-systems/` (151 brand packages), `plugins/` (277 official), `prompt-templates/` (93). The product bet: breadth of ready material plus any agent, rather than a structured editor. It has no two-way editing of its own: its README lists the tweaks panel as not implemented. That is the opposite bet from ours, and the reason a few of its ideas transfer cleanly and others do not.

## Part 1. Motion

### 1.1 What shipped (v0.25.0, 15 October)

- **Motion Design as a creation type**, second on Home right after Prototype, also in Community; motion skills appear in the `@` picker.
- **Five bundled examples**: Motion Future, Product Promo, Showreel, UI Morph, Visual Lesson. Each is a package with `example.html`, `assets/` (scripts, fonts, licensed audio), a baked HTML preview and a `SKILL.md`.
- **Two output paths.** A video brief yields editable HTML source plus a rendered MP4; an interaction/scroll/UI-driven animation ships as runnable HTML, never flattened video.
- **Failure contract**: export checks the MP4 decodes and that audio matches the declared policy; if export fails, the editable source is kept and the real error is reported.
- **Bounded quality check** (video briefs only): after the first render, check clock and size, compare captions with the required facts, view up to three frames (opening, key explanation, ending), make at most one targeted repair. Explicitly no acceptance agents, no numeric aesthetic scores, no open-ended polish loop (the PR removed a planned plan-contract parser and completion gate after review).
- Adapters for outside libraries as skills (not engines): GSAP-based `animate` / `ui-animation`, Huashu (35 art-style cards, 9 narrative cards), Oil Motion, Motion.Lab (160 animation cases with code and parameters, bilingual index).
- A sibling product, **motion-anything** (separate repo, same org): a chat-driven motion workbench with a recipe library (§1.4).

### 1.2 How motion is authored and rendered

The renderer is **HyperFrames** (HeyGen, Apache-2.0): a composition is one HTML page; a headless browser seeks the timeline frame by frame; FFmpeg encodes. OpenDesign's skill pins the contract:

| Piece | Contract |
|---|---|
| Root element | `data-composition-id="main"`, `data-start`, `data-duration`, `data-width`, `data-height`, a poster time |
| Time | one paused master GSAP timeline at `window.__timelines.main`; its real duration must equal `data-duration` (changing `tl.duration()` changes speed, it does not add a hold) |
| Seekability | must work forward and backward; no `Date.now`, unseeded randomness, state that needs play-from-zero, CSS animation fighting the timeline |
| Callbacks | the exporter **suppresses `onUpdate` / `onComplete`**, so visible content must not depend on them; canvas draws read the clock every frame |
| Assets | local only, wait for fonts and images before signalling ready |
| Audio | declared `od-motion-audio="required"` or `"silent"`; local pre-trimmed files with declared start, duration, volume; Web Audio alone does not export |
| Defaults | 12–18 s, 16:9 1920×1080 (9:16 for portrait), 30 fps, no invented voiceover |
| Deliverable meta | `od-motion-output` = `video` or `interactive`, plus an alternate link to the MP4 |

HyperFrames also has a **registry**: 150+ prebuilt *blocks* (standalone sub-compositions with their own size, duration and timeline: code animations, charts, lower thirds, shader transitions, device mockups) and *components* (effect snippets merged into a host), installed with `hyperframes add <name>` (or by tag). Outputs: MP4, MOV, WebM, GIF, PNG sequence; local, Lambda or Cloud Run.

### 1.3 The craft guidance inside the skill

The part of the SKILL.md worth reading as prose, because it is what makes an LLM's motion look intentional:

- a **beat map** first (time → takeaway → focal object → transformation → copy/audio → exit) and one recurring motif linking beats; settle **one strong representative frame** before expanding scenes;
- duration bands: accent 120–220 ms, main arrival 350–650, shape change 600–1200, large reveal/camera 900–1800; ease-out arrivals, ease-in exits, smooth in-out cameras, constant speed for mechanical things, no default bounce on precision instruments;
- visual grammars by genre (product, kinetic type, explainer/data, procedural art), a defect→fix table ("slideshow feel → carry one object through a transformation", "busy but empty → remove decoration and show the causal action").

motion-anything's `MOTION-SPEC.md` adds a **taste contract**: duration tokens (instant 80–120, fast 140–220, base 220–320, slow 320–500, deliberate 500–800, cinematic 800–2000 ms), easing tokens (ease-out default, spring-soft 170/26, spring-snappy 300/30, linear only for loops), a **restraint budget per viewport** (≤1 celebratory moment, ≤3 simultaneous entrances staggered 40–80 ms, ≤1 ambient loop, delight on user intent not on load), transform/opacity only, and a `prefers-reduced-motion` fallback for every recipe.

### 1.4 The effect ("recipe") library

motion-anything: 403 recipes (about 77 with live previews, the rest reference cards; 35 are dependency-free ports with sources in `ATTRIBUTION.md`). A recipe is a **folder**: `recipe.motion.yaml` (category, `intent_keywords`, `avoid_when`, `restraint`, license lineage), a self-contained `preview.html`, the implementation, a `SKILL.md`. A **router skill** maps a user's stated feeling ("snappy", "elegant", Chinese equivalents) to categories and curated recipes, so nobody needs to know library names, and "when ambiguous choose the more restrained one and ask one question". Shader recipes share a 58-line WebGL runner. Exports per source: component motion → JSON/CSS/React/Lottie; page → MP4/GIF/single HTML; recipe → portable `SKILL.md`. Also a **motion profile** dial (Subtle … Cinematic) and 59 brand packs.

### 1.5 Where we stand against it

| | OpenDesign / motion-anything | Tingly Design |
|---|---|---|
| Authoring model | agent writes HTML + GSAP; no GUI timeline | HTML scenes with `data-in`/`data-out`/`data-keys`; stage, timeline, click-to-edit, resize, undo write back to source (`.design/motion-editing.md`) |
| Time contract | one GSAP master timeline | each element's timing is an attribute, scene time is a pure function (`sceneAnim.ts`); same "callbacks suppressed / seekable" rules (`motion.md` §2) |
| Renderer | HyperFrames: Puppeteer + FFmpeg; no in-browser export | exact server render (Chrome + ffmpeg) **and** in-tab WebCodecs export; GIF; cover; single-file player |
| Shader effects | recipes sharing a WebGL runner | seekable `<x-embed>` + WebGL2 runtime, `effect-error` reporting, checker support still open (`motion-effects.md` §6) |
| Presets | 403 recipes with metadata, router | 14 entrance presets, 3 sample effects, **no library and no discovery** |
| Reuse across pieces | blocks/components installed by name | planned: place a canvas board as an effect (`effect-plan.md`), rhythm tokens in design systems (`rhythm-tokens-plan.md`); neither built |
| Quality gate | one bounded 3-frame review | `check`, `check --snapshots`, `--verify` reverse-seek (`harness.md`) |
| Audio | declared policy, local files | audio mix in `@dc/export`; no declared policy or check |
| Interop | HyperFrames-native | none |

Honest reading: their *engine* is not ahead of ours, and the in-tab export and two-way editing are things they do not have. Where they are ahead is **material and guidance**: a large, described, previewable library, and written taste rules the agent follows.

### 1.6 What to borrow (motion), ranked

1. **A taste contract in the motion skill, and as checker warnings.** Add duration/easing bands, the restraint budget and the reduced-motion rule to `.claude/skills/motion/SKILL.md` and `delegate.ts`; surface budget breaches as `checkScene` warnings (not errors), e.g. "5 elements enter within 300 ms". Cheap, no new format, helps fast AI and Claude Code alike. The bands also supply the default values for the rhythm tokens in `rhythm-tokens-plan.md`. Kinds: motion; slides for the builds.
2. **Beat map + defect→fix table in the skill** (§1.3). Pure text; our skill currently documents format, not craft. Their text is Apache-2.0 but should be rewritten in our voice, not copied.
3. **An effect library with metadata, built on our own mechanism.** Do not copy 403 reference cards. Ship a small curated set (aurora, edge glow, grain, gradient mesh, light sweep: the list already in `motion-effects.md` §6) as **canvas boards with `$time`** per `effect-plan.md`, each with one line of "when to use / when not" (`intent`, `avoid_when`, `restraint`) in the board's notes. Metadata is for the AI router and for a picker, so write it in the same sentence-with-a-reason form §5 of `motion-effects.md` already uses. Kinds: motion, slides (as targets); canvas (as source).
4. **Failure contract on export** (already close): source is kept, error is real. Add what we lack: a post-export decode check and a declared audio policy (`required` / `silent`) that `check` can verify.
5. **Interop with HyperFrames compositions** as an importer: `data-start`/`data-duration` clips → our scene elements with `data-in`. This would make the 150+ registry blocks usable and give a migration path; non-trivial because GSAP-driven blocks are not attribute-timed, so only the attribute-timed subset would import cleanly. Research spike first, not a commitment.
6. **Not borrowing**: the Subtle…Cinematic profile dial as a mode picker (against UX principle "eliminate mode pickers"; if wanted, it should be a named set of concrete rhythm tokens in the design system), generative video-model routing (out of scope), Lottie/React export of component motion (a different product, `motion.md` §1).

## Part 2. How OpenDesign manages design systems, themes, styles and libraries

### 2.1 The inventory and where each lives

| Thing | Where | Unit | Count |
|---|---|---|---|
| Design systems | `design-systems/<brand>/` | folder per brand | 151 (motion-anything: 59) |
| Design templates (starters) | `design-templates/<id>/` | `SKILL.md` + `example.html` + assets | prototype, deck, image, video, utility modes |
| Themes for decks | `design-templates/html-ppt-*` | 15 deck templates × 36 themes | theme and layout are separate axes |
| Functional skills | `skills/<name>/SKILL.md` | agent behavior, not rendering | 100+ |
| Plugins | `plugins/{_official,community,registry,spec}` | `open-design.json` + payload | 277 official, 183 reference examples |
| Prompt templates | `prompt-templates/` | prompt + preview | 93 |

The split is deliberate: templates populate a catalog of *renderable starters*, skills a registry of *agent behavior*; two endpoints (`/api/design-templates`, `/api/skills`). A design system is *brand context*, picked once and added to every prompt: "portable DESIGN.md in your repo, respected by every skill".

### 2.2 The design-system package

Required: `manifest.json` (id = folder slug, name, category, description, provenance, file paths), `DESIGN.md` (agent-facing guidance, at least seven substantive H2 sections, headings free), `tokens.css` (compiled semantic tokens that must agree with the prose). Optional: `USAGE.md`, `components.html`, assets, fonts, previews, source evidence. **Derived caches** (`components.manifest.json`, `design-tokens.json`, `tailwind-v4.css`) are generated from `components.html` + `tokens.css` and *guarded in CI to stay in sync*. Legacy packages are a bare `DESIGN.md` (H1 + `> Category:` line), still read as a fallback.

How it gets fast for the user:

- **Catalog in the box**, grouped (AI & LLM, Developer Tools, Productivity, Fintech, E-commerce, Media, Automotive, Starters…), so the first project already has a brand to choose.
- **Import flows** that turn an existing source into a package: from a local folder, from GitHub, from shadcn, in the UI and as `od design-systems import-*`. A bulk script re-syncs upstream-derived brands.
- **Drop-in**: add a folder with a `DESIGN.md`; the catalog is rescanned on every request, no restart.
- **Selection is one picker**; the chosen system's content is appended to the agent prompt. Switching changes the next render. Theming *is* design-system selection; there is no separate theme object.
- **Prose first, tokens second.** `DESIGN.md` is what the model reads; `tokens.css` is what the render uses; a guard keeps them consistent. Quality is therefore only as good as the model's reading of the prose.

### 2.3 Templates, themes, plugins and onboarding

- **Creation types on Home** (Prototype, Motion Design, Deck, Image, Video …) as chips in one ordered config; a type opens a gallery of bundled examples ("start from the example"); the `@` picker adds skills mid-conversation. Examples ship with scripts, fonts, licensed audio, and a *baked preview*, so the gallery is instant and works offline.
- **Decks: theme × template**: 36 themes over 15 layouts rather than 540 files.
- **Plugins** are a manifest (`open-design.json`) around a payload (`SKILL.md`, `template.json`, `DESIGN.md`), with `od plugin list|search|info|install|apply|upgrade|uninstall --json` and a registry. It makes everything above installable and shareable by name. It is also the heaviest piece: versioning, trust, upgrade semantics.
- **Time to first result**: choose a local CLI or BYOK straight from Home (login optional); desktop app, Docker, one-line `od mcp install <agent>`; recent projects and run status on one Home. The 20-minute "rebuild a design" claim on their site is a self-set benchmark, not measured.
- **Quality**: a `critique` utility template (five-dimension scoresheet); a lint API and pre-emit self-critique gate are on their roadmap, not shipped.

### 2.4 Where we stand

| | OpenDesign | Tingly Design |
|---|---|---|
| Design system format | `DESIGN.md` prose + `tokens.css` + `manifest.json`; tokens are a derived/guarded view | structured `tokens.json` (colour themes, type, spacing, radius, shadow) is the source; `tokens.css` generated; README, components with live previews, assets (`.claude/skills/design-system`) |
| Editing | by agent or by hand in files | token editor, contrast, live previews, two-way |
| Catalog | 151 | **1 sample** (`tingly-ds`) |
| Getting a brand in | import from folder / GitHub / shadcn, or write `DESIGN.md` | author in the editor or ask Claude; import from HTML/SVG exists (`import-external-material.md`), not "extract a brand" |
| Who can use it | every skill/template | installed into canvas and slides only; motion, dashboard, docs are ✗ (`project-kinds.md` matrix) |
| Themes | = design system | colour themes inside a design system; editor theme is separate (`theming.md`) |
| Starters | gallery per creation type, with baked previews | one sample project per kind, a blank starter on New |
| Packaging/sharing | plugins + registry | whole-project `.zip` out/in (`project-archive.md`), `tingly-design import <file.zip>` |
| Rhythm / motion style | duration & easing tokens only in motion-anything's spec | planned `motion` token family (`rhythm-tokens-plan.md`) |

### 2.5 What to borrow (themes, styles, libraries), ranked

1. **Make the design-system catalog exist before making it clever.** The largest gap is 1 vs 151. Cheapest path with the biggest effect: **read and write `DESIGN.md`**. An *import* of an OpenDesign `DESIGN.md` (+ `tokens.css` when present) into our `tokens.json` + README gives the user their 100+ brand packages on day one; an *export* of ours as a `DESIGN.md` makes our systems usable in OpenDesign and by any agent that already reads it. `tokens.css` → `tokens.json` mapping is mechanical for colours/type/spacing/radius/shadow; the prose goes to README. Kinds: design-system (owner), canvas, slides (consumers). Licensing of each upstream brand package must be checked before bundling any; importing on the user's request avoids shipping them.
2. **"Extract a brand from X"** as an import source, beside HTML/SVG: from a URL, a Tailwind/shadcn config, or a folder → a design-system project. They have three importers; our importer package already parses HTML, so a first pass (computed colours + fonts + radii from a page) is plausible. Fits UX principle "hand over the artifact for the next action".
3. **Open the design-system picker to the kinds that ignore it.** Motion (rhythm tokens, fonts, colours), docs and dashboard are ✗ today. Their model, "one picked system flows into every artifact", is exactly the gap. Motion first (needs the `motion` family, `rhythm-tokens-plan.md`), because that is where §1.6 items 1 and 3 meet: bands become the default tokens, effects take their accent from colour tokens.
4. **A starters gallery in the New dialog** instead of only a blank project per kind: our `projects/` samples shown as cards with a baked cover (the launcher already renders live covers), grouped by kind, with "start from this". Respect "eliminate mode pickers": one gallery, kind comes from the card.
5. **Separate axes for deck/motion style: theme × layout.** Ours are already separate (design system vs slide HTML); the missing piece is a handful of layouts/builds that read tokens, so N systems × M layouts produce N·M looks without N·M files.
6. **A lightweight "pack" instead of plugins.** We already have the archive format. A pack = a `.zip` of one or more projects (a design system, a canvas of effect boards, a deck) plus the `tingly-design.json` manifest; an index file in a repo lists packs with a title, kind, tags, cover. `tingly-design import <url>` and an "Import from the library" row in New would be the registry. No manifest versioning or upgrade flow until someone asks. This is the cheap 80% of their plugin system.
7. **Derived-cache guards**: they CI-check that generated files match their sources. We already generate `tokens.css`; extending `pnpm test` to fail when a bundled design system's generated files drift is a small hardening.
8. **Not borrowing**: the agent-only workflow without editing, 27 runtimes (we have AiSettings), prompt-template and Seedance/Veo catalogs, the plugin versioning machinery.

## 3. Cross-kind view (`.design/project-kinds.md`)

| Idea | Canvas | Slides | Design system | Dashboard | Docs | Motion |
|---|---|---|---|---|---|---|
| Taste contract / budget warnings (§1.6.1) | — | builds only | — | — | — | ✓ checker + skill |
| Effect library as `$time` boards (§1.6.3) | source | target | — | — | — | target |
| `DESIGN.md` import/export (§2.5.1) | consumer | consumer | owner | — | — | via 2.5.3 |
| Brand extraction import (§2.5.2) | — | — | creates one | — | — | — |
| Open design-system install (§2.5.3) | ✓ | ✓ | — | needs a decision | needs a decision | needs `motion` family |
| Starters gallery / packs (§2.5.4, 6) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (New dialog is shared) |

## 4. Suggested order, and what needs a decision

1. Taste contract in the motion skill + budget warnings (small, no format change).
2. `DESIGN.md` import/export for design systems (medium; unlocks the catalog and interop).
3. Rhythm tokens + effect boards (both already planned; this research adds the metadata and the default bands).
4. Starters gallery and packs (medium; product decision on where the index lives and who curates it).
5. HyperFrames importer spike (research only).

Open questions for the owner: whether to depend on OpenDesign's `DESIGN.md` as an interchange format at all (a de-facto but unspecified format owned by another project); whether packs are curated in this repository or in a separate one; whether dashboard and docs should take a design system.
