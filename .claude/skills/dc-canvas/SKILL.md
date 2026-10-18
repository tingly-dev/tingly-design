---
name: dc-canvas
description: Read before creating or editing a design canvas under projects/ (canvas.json and *.dc.html artboards) — the file format, the template syntax, and the rules that keep files editable on the canvas.
---

# DC canvas files

A canvas is a folder under `projects/<name>/`:

- `canvas.json` — where every artboard sits, plus notes and titles.
- `<Name>.dc.html` — one file per artboard: a self-contained HTML page with a template and an optional logic class.

The editor (`pnpm dev`, http://localhost:5173/?p=<name>) watches these files. Anything you write shows up on every open canvas within a second, and is recorded in the canvas journal as an outside edit. People edit the same files from the canvas, so **read a file right before you change it** and change only what was asked.

## canvas.json

```json
{
  "v": 3,
  "title": "Settings redesign",
  "boards": { "Main.dc.html": { "x": 0, "y": 0, "w": 1200, "h": 760, "title": "Current" } },
  "order": ["Main.dc.html"],
  "notes": {
    "t1": { "kind": "title1", "x": 0, "y": -260, "text": "What we ship first", "maxW": 2480 },
    "s1": { "x": 1280, "y": 0, "w": 520, "fill": "green", "size": 20, "text": "A sticky note" }
  },
  "pages": [],
  "launch": { "view": "canvas" },
  "designSystems": []
}
```

- `boards`: one entry per artboard file, keyed by its path in the folder. `x`, `y`, `w`, `h` in CSS px. Leave 80 px between artboards in a row and 120 px between rows. Optional `title`, `is_interactive: true` (the artboard has working controls), `radius`.
- `order`: the same paths, back to front. The first is `Main.dc.html`.
- `notes`: `kind: "title1"` is a 72 px heading over several artboards (keep it ≥ 223 px above their row); no `kind` is a sticky note with `w` and a `fill` of gray, red, orange, green, teal, blue, purple or pink.
- `notes` can also hold pictures: `{ "kind": "image", "x", "y", "w", "h", "src": "uploads/photo-1a2b3c4d.png", "alt" }`, the path relative to the folder.
- A `boards` entry with `imported` (`from`, `source`, `original`, `at`) came from an imported page or SVG; `original` is that file, kept under `uploads/`. Keep the key.
- `boards` and `notes` entries take `hidden: true` (not drawn) and `locked: true` (can't be moved or edited on the canvas); they are the layers panel's eye and lock. Keep them.
- Keep every key you are not changing. To add an artboard, write its file and add a `boards` entry and an `order` slot.

Files people brought in (attachments, imported pages and pictures) live under `uploads/`. An artboard shows one by its path from the folder, `<img src="uploads/…">` or `url(uploads/…)`; don't move or rename them.

## An artboard file

```html
<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>Pricing</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
body{margin:0;font-family:system-ui,sans-serif;color:#1f2430}
</style>
</helmet>
<div style="width:880px;height:560px;box-sizing:border-box;padding:48px;display:flex;flex-direction:column;gap:24px">
  <h2 style="margin:0;font-size:28px;color:{{accent}}">Choose a plan</h2>
  <sc-for list="{{plans}}" as="plan" hint-placeholder-count="3">
    <div style="padding:16px;border:1px solid #e3dfd4">{{plan.name}} — {{plan.price}}</div>
  </sc-for>
  <sc-if value="{{yearly}}" hint-placeholder-val="{{ false }}">
    <p style="margin:0">Billed yearly</p>
  </sc-if>
  <button onClick="{{toggle}}" style="height:44px;padding:0 16px">Switch billing</button>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"accent":{"editor":"color","default":"#2f6fed"},"$preview":{"width":880,"height":560}}'>
class Component extends DCLogic {
  state = { yearly: false };
  renderVals() {
    const yearly = this.state.yearly;
    return {
      accent: this.props.accent ?? '#2f6fed',
      yearly,
      toggle: () => this.setState({ yearly: !yearly }),
      plans: [['Solo', 0], ['Pro', 20]].map(([name, m]) => ({ name, price: m ? '$' + (yearly ? m * 0.8 : m) : 'Free' })),
    };
  }
}
</script>
</body>
</html>
```

### Template rules (each one fails silently if broken)

- Keep the `<script src="./support.js"></script>` line, the `<x-dc>` block and the `<script type="text/x-dc" data-dc-script>` block.
- `{{path}}` is a dotted lookup into what `renderVals()` returns (`{{plan.name}}`, `{{$index}}`, literals like `{{ true }}`). Never an expression: compute it in `renderVals()` and return it by name.
- An attribute that is exactly one hole gets the raw value (a function for `onClick`, an array for `list`); otherwise holes are interpolated into a string.
- Events are camelCase attributes bound to functions: `onClick="{{toggle}}"`. Per-item handlers: put a function on each item in `renderVals()` and bind `onClick="{{item.pick}}"` inside the `<sc-for>`.
- `<sc-for list as>` repeats, `<sc-if value>` branches, `<dc-import name="Card" item="{{it}}" hint-size="320px,120px"></dc-import>` mounts the sibling file `Card.dc.html`. Always set the `hint-*` attributes.
- The logic class is classic JS, `class Component extends DCLogic`, no imports. You get `this.props`, `this.state`, `this.setState` and React class lifecycle methods.
- All UI is markup inside `<x-dc>`; never build DOM from script.
- Close every non-void element and quote every attribute.

### Rules that keep a file editable on the canvas

The canvas edits these files in place: a person selects an element and changes its inline style in a properties panel, double-clicks text to retype it, and a fast in-page model rewrites elements with jQuery. All of that works on the markup as written, so:

- Put visual properties in inline `style="…"`. `<helmet><style>` is only for page basics (`body`, `a`, fonts).
- Write copy as literal text in the markup, not through `renderVals()`, unless it really is data. Literal text can be retyped in place, and so can a hole that shows a text prop in `data-props` (no `editor`, or `"text"`, with a string `default`), alone (`{{heading}}`) or inside copy (`Hello {{name}}!`): retyping the value changes that prop's default and the part around it changes the template, the hole stays. Text fed only by `renderVals()` data cannot be retyped on the canvas. For a list a person should edit on the canvas, declare it in `data-props` (`"plans":{"default":[{"name":"Solo","price":"$9"}]}`), return `this.props.plans` from `renderVals()` and loop over it with `<sc-for list="{{plans}}" as="plan">`: retyping `{{plan.name}}` on the canvas changes that row of the list. A colour that is one hole (`color:{{accent}}`) with `accent` a colour prop is shown in the Properties panel as the colour it is, and changing it there changes the prop.
- Lay out siblings with flex or grid plus `gap`. Write grids as `grid-template-columns: repeat(N, minmax(0, 1fr))`.
- `data-props` declares Tweaks — a few real levers (an accent colour, a density enum, a dark toggle), never label copy. Every prop with a `default` is listed in the Tweaks tab; one without an `editor` shows as text, a switch or a number by its default. It is a single-quoted JSON attribute: escape `&` as `&amp;` and `'` as `&#39;`.
- An artboard that moves with time (an effect: a backdrop, a glow, a looping chart) declares `"$time": {"loop": "8s", "still": "2s"}` in `data-props` (`loop` optional; `still` is the moment shown when nothing plays it). It draws **only** from `this.props.time` (ms): no `setInterval`, `requestAnimationFrame`, CSS animations or `Date.now()`, so a motion piece can show any frame of it exactly. Decks and motion pieces import such artboards (they copy it into their `uploads/`), and their embeds set its tweaks; the canvas's Tweaks tab has a time slider to look at any moment. `projects/box-console/Glow.dc.html` is an example.
- Diagrams (boxes and arrows): one host `<div style="position:relative;width:…;height:…">`, every box an absolutely positioned `<div>` with its label as text, every straight arrow segment its own small `<svg>`. Never one big `<svg>`: the canvas would select it as a single block.
- Sizes: phone screen 390×844; desktop screen or page width 1280–1440. A board's size is written in three places that must agree: the root element's `width`×`height` in its style (what is drawn), `w`×`h` in `canvas.json` (`check` reports a mismatch as an error) and `$preview` in `data-props` (the size used when another file embeds the board; `check` warns on a mismatch). Change all three together. The height is a guess until you have drawn the board: `check --snapshots` warns when a band of the board is empty, so set the height from the content, not the other way round.

## Hidden and locked elements

`data-hide` on an element means it isn't drawn (it, and everything inside, stays in the file); `data-lock` means it can't be picked, moved, resized or retyped on the canvas. Both are plain boolean attributes, the layers panel's eye and lock, and they work the same in slides and motion scenes. Keep them when you rewrite an element; add `data-hide` rather than deleting something the user only asked to hide.

## Handle ids

The editor shows elements by handle ids such as `#dc12`. They are not in the file: `dc12` is the 13th element (counting from 0) in document order inside `<x-dc>`, every tag counted, including `<helmet>` and the `<style>` inside it. When a request names a handle, find the element by counting, or better, by the label and source snippet that come with the request.

## Content

No lorem ipsum and no invented numbers: unknown facts become placeholders like `[价格]`. The exception is a brief that is itself invented (a made-up brand, a demo or sample page): then write plausible concrete figures and names, and say in your reply that they are made up. Real `<button>`, `<a href>`, `<input>` + `<label>`; `aria-label` on icon-only buttons; text contrast at least 4.5:1.

## Punctuation

Text people read (on the page, in notes, titles and descriptions) uses its language's own punctuation: in English the curly apostrophe (’) and quotation marks (“ ” and ‘ ’), in Chinese full-width punctuation and the quotation marks the text already uses (“ ” or 「 」). Straight quotes only as code, HTML, CSS or JSON syntax, and for feet and inches.

## Look at what you made

`tingly-design check <name> --snapshots` checks the files and draws every board that is not hidden as the editor's Export menu does, into `projects/<name>/renders/check/`. Read the PNGs to see the result; anything listed as "could not be drawn" is broken, and so is a script that "threw while the editor showed it"; "lists …, which is missing" names a file you referenced that is not there, and "did not load" a picture, font, style or script that never arrived. Warnings about the layout (text "cut off by its box", text that "runs past the edge", text "hard to read on its background", "nothing is drawn") are worth fixing unless the design means it. `tingly-design export <name> --as png --board <file or title>` draws one board (`--scale 2` for PNG @2x). Run `tingly-design` as the editor that started you ships it, so it sees the same projects folder and version: `node cli.mjs …` when `cli.mjs` is in the working directory (the shipped bundle), `pnpm tingly-design …` in this repository, otherwise the installed `tingly-design …`; not `npx`, which may fetch another version. With Tingly Design's MCP server connected (`tingly-design mcp`, or the editor's `/mcp`), its `check`, `look` and `export` tools do the same (`look` hands the pictures back, one thing at a time with `pick`).
