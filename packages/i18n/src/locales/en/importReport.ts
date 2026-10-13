export default {
  /** the sticky note an import leaves next to its artboards */
  note: {
    fromSvg: 'Imported from SVG',
    fromHtml: 'Imported from HTML',
    fromSvgFile: 'Imported from SVG: {{file}}',
    fromHtmlFile: 'Imported from HTML: {{file}}',
    allSvg: 'The drawing came over complete',
    allHtml: "The page's content and styles came over",
    nextSvg:
      'The drawing stays SVG: select a shape to change its colour, stroke and position, and edit text directly (if it is still text). To turn it into ordinary layout elements (flex, editable text), select the artboard and have AI rebuild it.',
    nextHtml:
      'Every element keeps its styles in its own style attribute, so you can select and change it directly. For a cleaner structure (flex layout, less nesting), select the artboard and have AI tidy it up.',
  },
  /** one line per finding */
  line: {
    artboards_one: '{{count}} artboard',
    artboards_other: '{{count}} artboards',
    elements_one: '{{count}} element',
    elements_other: '{{count}} elements',
    summary: '{{artboards}}, {{elements}}',
    summaryTruncated: '{{artboards}}, {{elements}} (over the limit; the rest was not imported)',
    scripts_one: '{{count}} script was not brought over: the import is the page as rendered, so interactions need to be rebuilt',
    scripts_other: '{{count}} scripts were not brought over: the import is the page as rendered, so interactions need to be rebuilt',
    stateRules_one: '{{count}} hover, focus or other state style was not brought over',
    stateRules_other: '{{count}} hover, focus and other state styles were not brought over',
    otherMediaRules_one: '{{count}} style that applies only at other screen widths was not brought over',
    otherMediaRules_other: '{{count}} styles that apply only at other screen widths were not brought over',
    hidden_one: '{{count}} hidden element (display:none) was not imported',
    hidden_other: '{{count}} hidden elements (display:none) were not imported',
    transparent_one:
      '{{count}} piece of content is transparent (opacity 0, usually an animation that plays on scroll); select it and set opacity to 100% to see it',
    transparent_other:
      '{{count}} pieces of content are transparent (opacity 0, usually animations that play on scroll); select them and set opacity to 100% to see them',
    pseudoElements_one: '{{count}} ::before / ::after became a real <span>',
    pseudoElements_other: '{{count}} ::before / ::after became real <span>s',
    dropped: "Removed elements a canvas can't hold: {{list}}",
    unreadableSheets_one: "{{count}} stylesheet couldn't be read (cross-origin), so its styles are missing",
    unreadableSheets_other: "{{count}} stylesheets couldn't be read (cross-origin), so their styles are missing",
    missing_one: '{{count}} referenced file is not among the imported files: {{list}}',
    missing_other: '{{count}} referenced files are not among the imported files: {{list}}',
    missingMore_one: '{{count}} referenced file is not among the imported files: {{list}} and more',
    missingMore_other: '{{count}} referenced files are not among the imported files: {{list}} and more',
    remoteUrls_one: '{{count}} resource is still a remote link and was not copied into the project',
    remoteUrls_other: '{{count}} resources are still remote links and were not copied into the project',
    outlinedText:
      'No editable text: the text was probably turned into paths on export. Untick "Outline text" when exporting SVG from Figma to keep it',
    bitmaps_one: "{{count}} embedded bitmap (a screenshot or photo) was imported as an image; its content can't be edited",
    bitmaps_other: "{{count}} embedded bitmaps (screenshots, photos) were imported as images; their content can't be edited",
  },
  /** between the items of a short list in a line */
  listSep: ', ',
  error: {
    notSvg: 'This is not a valid SVG file',
  },
};
