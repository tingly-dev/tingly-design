# Slides PPTX interchange research

Status: historical candidate research, observed 2026-10-21. This page's upstream observations did not include execution of third-party converters. Current implementation and verification are recorded in the [design contract](../.design/slides-pptx.md) and [verification record](./slides-pptx-verification.md). Mutable upstream URLs are not pinned dependency approvals.

## Product boundary

PPTX -> Tingly slides and Tingly slides -> a fresh PPTX are independent conversions. All editing happens in `deck.json` and `slides/*.html`. There is no parallel PowerPoint state, original XML patching, or lossless package round-trip requirement. Current contract: [slides-pptx](../.design/slides-pptx.md).

## Evidence and implications

| Source | Verified observation | Implication / limit |
|---|---|---|
| [Microsoft PresentationML structure](https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document) | Presentation, slides, masters, layouts, themes and notes are separate parts linked by relationships | A useful importer must resolve relationships and necessary inherited values, not merely enumerate slide XML filenames |
| [PptxGenJS README](https://github.com/gitbrent/PptxGenJS/blob/master/README.md), [manifest](https://github.com/gitbrent/PptxGenJS/blob/master/package.json) | MIT; browser/Node creation of native PPTX objects; HTML conversion specifically covers tables | Export foundation, not a reader or arbitrary HTML layout converter. Actual manifest includes dependencies; measure pinned build, not marketing claims |
| [pptx2json](https://github.com/x1-/pptx2json/blob/master/index.js) | Low-level XML/ZIP JSON representation, not resolved semantic layout | Does not remove the need for an editor-specific import mapping |
| [PPTXjs](https://github.com/meshesha/PPTXjs/blob/master/README.md), [PPTX2HTML](https://github.com/arantes555/PPTX2HTML/blob/master/README.md) | MIT preview-oriented converters; PPTXjs documents legacy JSZip v2 and jQuery/D3-era integration | Reference material rather than a trusted drop-in editable format; advertised support was not exercised |
| [pptx-preview registry](https://registry.npmjs.org/pptx-preview) | ISC metadata conflicts with README source modification/redistribution restrictions | Do not adopt until governing license is clarified |
| [dom-to-pptx metadata](https://registry.npmjs.org/dom-to-pptx/latest), [html-to-pptx metadata](https://registry.npmjs.org/html-to-pptx/latest) | Wrapper candidates; first includes Puppeteer-related dependencies | Source behavior, browser footprint and native/raster conversion not verified; cannot assume lightweight suitable reuse |

## Related products

- **[OpenDesign](https://github.com/nexu-io/open-design/blob/main/README.md)**: official README lists PPTX as **agent-driven skill**, with version history describing **screenshot-backed PPTX / PDF**. This verifies an export capability and an image-based route, not that every current route is raster-only, nor that native editable export exists. README did not establish PPT/PPTX import. Actual export handlers were not retrieved. Its [guizang-ppt](https://github.com/op7418/guizang-ppt-skill) and [html-ppt](https://github.com/lewislulu/html-ppt-skill) references are HTML presentation skills, not proof of native conversion.
- **[ONLYOFFICE Presentation Editor](https://helpcenter.onlyoffice.com/docs/userguides/presentation_editor/SupportedFormats.aspx)**: official format documentation lists PPT/PPTX inputs and PPTX download; non-native editing inputs are converted to OOXML. A full Office-engine approach, not a small HTML conversion adapter. Redistribution/license selection was not verified here.
- **[ShapeCrawler](https://github.com/ShapeCrawler/ShapeCrawler/blob/master/README.md)**: MIT C#/.NET API for reading, creating, editing and saving native PPTX on top of Open XML SDK. Its slide-image API is explicitly experimental. Useful object-model reference, not a ready HTML conversion layer.
- **[Open XML SDK](https://github.com/OfficeDev/Open-XML-SDK/blob/main/README.md)**: MIT low-level OPC/Open XML API, explicitly not intended to provide high-level abstractions. Requires .NET and format knowledge; does not solve browser text layout.

No claims about Presenton, PPTist or Slidev support are established by this research: network retrieval was incomplete. No third-party code was installed or executed.

## Proposed technical direction

Use bounded OOXML parsing to emit the existing editable slide subset. Resolve necessary master/layout/theme inheritance into concrete values and positioned elements; retain original and media in uploads. Export the current source snapshot by measuring browser layout and writing native objects through PptxGenJS, with honest static fallback where actually renderable. Rebuild a new PPTX, not a patch of the input.

Images are not universal import fallback: ordinary PPTX packages need not include slide/shape preview images, and there is no installed general DrawingML renderer. Preserve supported text and expose unsupported objects through diagnostics; do not claim unseen content was preserved.

## Historical module-first scope

The initial delivery isolated the importer, native writer and measured-DOM adapter before product integration. Editing remained in Tingly source. Product integration is now implemented; see the current design contract rather than treating the initial scope as a limitation.

## Verification follow-up

Executed dependency, bundling, synthetic-fixture, security and schema checks are summarized in the [verification record](./slides-pptx-verification.md). External Office rendering, visual comparison, font substitution and continued native-object editing remain separate verification gates. Self-import alone is not evidence of interoperability.
