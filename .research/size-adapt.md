# Content that follows a size change

Status: research. Question: after a person adds or switches a size (canvas artboard, slide deck, motion format), why does the content mostly not fit, and what is the one shared way to fix it?

## What happens today, per kind

| Kind | How a size is set | What the content does |
|---|---|---|
| Canvas | W/H fields and the preset list in the board panel write `w`/`h` in `canvas.json` (`updateBoard`) | The frame changes, the artboard's own HTML does not: the root element still says `width:1200px;height:760px` and everything inside is fixed px. Switching to Mobile shows a 390 px frame holding a 1200 px page, cropped. |
| Slides | Chosen once in the New dialog (`deck.json` `size`); no way to change it afterwards | A deck stays in the size it was made in. Pages imported from a PPTX keep the source page shape. Nothing adapts because nothing can change. |
| Motion | `addFormat` / `setFormatSize` write `formats` in `motion.json` | Scenes are shared by all formats; an element only differs where it carries a `data-<format>` override. A new format starts with none, so a scene written for 1920×1080 is drawn unchanged at 1080×1920: fixed `width:1500px` rows overflow. |

Common cause: layouts are written in absolute CSS pixels for one reference size, and nothing records or recomputes that reference when the size changes.

## Options

1. **Scale to fit (transform).** Draw the unchanged content in a box of the old size, scale it uniformly into the new frame. Zero edits, exact for the same aspect ratio. Wrong for a different ratio: letterboxing or cropping, and the person cannot edit the result as a layout of the new size. Good as a preview, not as the answer.
2. **Relative units / container queries** (`cqw`, `cqh`, `%`, flex/grid). The right way to author, and what the starters and the skills should prefer. It does not fix existing content, which is px, and rewriting it automatically is the same problem as option 3.
3. **Deterministic rescale of the source.** Parse the inline styles (core already has the closed subset parser, `parseDc`), multiply lengths by sx (x, width, left, right, horizontal padding/margin, gap in a row) or sy, and font sizes and radii by the smaller factor, and rewrite the root size. Keeps the file plain and editable, undoable, same in every kind, runs offline and instantly. Good for ratios within roughly ±30 %; past that text no longer fits the way it did, which is the honest limit of any mechanical rule.
4. **Agent re-layout.** Ask Claude Code (or the fast model) to re-lay out for the new size, as Claude Design does. Best result for large ratio changes (16:9 → 9:16), costs a run, can be wrong. Already available: the delegate path exists for every kind.
5. **Reuse a library.** Nothing off the shelf rewrites an arbitrary inline-styled HTML file to a new size; layout engines are about authoring. Not worth a dependency.

## Recommendation

Two steps behind one abstraction, `adaptSize` in core (`packages/core/src/sizeAdapt.ts`), used by every kind:

- **Deterministic rescale (option 3) is the default, applied at the moment of the size change**, with a plain choice in the same place: "Scale content" (default) or "Keep content". No other mode picker.
- **When the aspect ratio moves by more than ~30 %, the result says so and offers "Ask Claude to re-lay out"** (option 4), handing the new size, the old size and the files to the existing delegate. The mechanical pass has already run, so the agent starts from a sane draft.
- New content is written with relative sizes where it matters (skills updated), which makes the mechanical pass a no-op on it.

Per kind:
- Canvas: changing W/H or picking a preset runs `adaptSize` on the artboard HTML and rewrites its root box; the board entry follows.
- Slides: a Size item in the deck's panel (it does not exist yet) changes `deck.json` `size` and runs `adaptSize` on every slide.
- Motion: adding a format seeds the new format's `data-<format>` overrides from the same pass instead of leaving them empty; the primary format's source is not touched.

## Open

- Images and `background-size`: kept proportional rather than stretched.
- Template artboards (`<sc-for>`, `{{holes}}`): the pass leaves holes untouched; only literal lengths change.
- Lengths inside `calc()` or in `vw`/`%` units are left alone.
