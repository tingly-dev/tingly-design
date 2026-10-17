# Images and SVG

Adapted from the original Slides type's reference; rules here hold for Tingly Design's slide subset.

This page explains more than just `<img src="assets/reef.jpg" alt="…">`. It covers where image files live, SVG rules, borders and shadows on images, and what happens when you drop images in the editor. For information about fonts, see the `fonts.md` page.

## Where images live

Every image FILE is a file in the deck folder — `assets/…`, or `uploads/…` for what a person attached — and the slide refers to it by its path relative to the deck, written as the `src`. The image data never goes into a slide: never write a `data:` URI. That keeps slide files small.

- `png`, `jpg`, `webp`, and `gif` files work as they are. If a photo is much bigger than it will show on the slide, it is worth shrinking it first to about 2× its box.

- An `svg` file works too, and is shown with `<img>`. A small SVG (52 KB or less) can go into the slide as `<svg>` code instead (see SVG below).

- If you do not have the image file, do not write the image into the slide yourself. Leave an empty frame where it belongs: `<img alt="what goes here" style="width:…; height:…">` with no `src`. It keeps its box. Tell the user which images are missing.

Never use a URL in `src` — for example `src="https://…"`. Nothing fetches URLs. Save the image as a file in the deck folder.

When you read a slide's file, its `src` values are paths in the deck folder (`assets/…`, `uploads/…`). Keep every `src` exactly as it is if you edit the slide.

## SVG

Use SVG when crisp vector art matters — for example logos and diagrams. You can use `<img src="assets/file.svg" alt="…">` or put the `<svg>…</svg>` code right in the slide. See SKILL.md for more on this. Either way, the slide viewer treats the SVG as a static, sandboxed image:

- Scripts in the SVG never run.
- External references the SVG points to never load.
- SMIL animation in the SVG does not play.

If you put `<svg>` code directly in the slide, keep to these rules:

- No script
- No `on*=` event handlers
- No `<foreignObject>` elements
- No SMIL animation
- No URLs
- The SVG code must be 52 KB or smaller

The markup inside the `<svg>` is kept exactly as you wrote it, and comes back unchanged when you load the slide to edit it. An `aria-label` on the `<svg>` is its description (the image's alt): set one when the graphic carries meaning — a chart, a plan, a map — and leave it off pure decoration.

The slide shows the `<svg>` as an image, which a browser reads as XML. So inside it write a character only as itself (`—`), as its number (`&#8212;`) or as one of XML's five names (`&amp;` `&lt;` `&gt;` `&quot;` `&apos;`): any other `&name;`, or a bare `&`, breaks the whole drawing.

Fonts never load inside an SVG. Any `<text>` elements render in a system font, not the deck's font, and the text gets clipped. So keep diagram labels OUT of the SVG. Paint them as real text over the SVG instead. See the "Labels over an image" section of `layout.md`. The editor's format check notes every `<text>` element it finds in an `<svg>`.

## Display treatment

View each image and decide how it is best shown. Photos fill their box (`object-fit:cover`). For screenshots and diagrams, fit them inside the box, keeping their original shape (`object-fit:contain`). Put screenshots and diagrams on a contrasting background. Rarely put anything on top of a screenshot or diagram. Diagram labels are the exception.

If you put text on top of an image, protect it the way the deck's direction would — a card, a scrim (`background:rgba(20,20,19,.6)`), or a `backdrop-filter:blur()` panel. Do it the same way every time.

Do not use emoji or draw your own decorative art, unless the user asks for it. Use the images the user gives you, or a line icon (`<x-icon>`) — but use icons sparingly. If the user does not give you any images, a deck with no images and good structure is a fine deliverable. Never make up an image. Never use an image file that you do not have.

## Borders and shadows

The `border`, `border-radius`, and `box-shadow` properties work the same way on an `<img>` as they do anywhere else (see styles.md).

## In the GUI

If you click the Insert image button in the toolbar, it opens a file picker for pictures. A picture the person adds, picked or dropped, goes onto the current slide, and its file is kept in the deck's `uploads/`. You do not need to place every image.
