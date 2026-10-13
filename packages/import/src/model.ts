/**
 * The page model every source is read into, as plain JSON.
 *
 * Each source (sources/html, sources/svg, later Figma…) only has to produce
 * this; the generator that turns it into project files is shared, pure and
 * runs anywhere. Keeping the boundary as data means a source can change, be
 * tested or be added without touching the others.
 */

export interface XElement {
  kind: 'el';
  tag: string;
  ns: 'html' | 'svg' | 'math';
  /** attributes kept as written (urls already absolute) */
  attrs: [string, string][];
  /** inline style text: the author's declarations, resolved, as one `style` attribute */
  style: string;
  children: XNode[];
  /** layout facts the generator uses to format and split, never written out */
  box: { top: number; height: number; marginTop: number; marginBottom: number; display: string; whiteSpace: string };
  /** made from a ::before / ::after box */
  pseudo?: 'before' | 'after';
}

export interface XText {
  kind: 'text';
  text: string;
}

export type XNode = XElement | XText;

export interface ExtractReport {
  elements: number;
  /** rules that only apply on :hover, :focus, :active… (not carried over) */
  stateRules: number;
  /** @media blocks for other viewport sizes (not carried over) */
  otherMediaRules: number;
  /** stylesheets the page could not read (cross-origin without CORS) */
  unreadableSheets: string[];
  scripts: number;
  /** elements hidden with display:none, left out */
  hidden: number;
  /** boxes with content left at opacity 0 (outermost only), usually reveal-on-scroll effects */
  transparent: number;
  /** ::before / ::after boxes turned into real <span>s */
  pseudoElements: number;
  /** elements with no place on a canvas: iframes, video, objects… */
  dropped: Record<string, number>;
  /** stopped early at the element limit */
  truncated: boolean;
  /** SVG: no <text> but paths, so the text was most likely outlined on export */
  outlinedText?: boolean;
  /** SVG: embedded bitmaps, imported as images whose content can't be edited */
  bitmaps?: number;
  /** other findings a caller adds, already in the language it shows */
  notes?: string[];
}

export interface Extracted {
  /** which source produced it: names the import in canvas.json and the report */
  from: 'html' | 'svg';
  title: string;
  lang: string;
  /** the viewport width the page was laid out at */
  width: number;
  /** the full height of the page at that width */
  height: number;
  /** the page as one root element (the <body>, carrying <html>'s and <body>'s styles) */
  root: XElement;
  /** rules kept for the whole page: @font-face, @keyframes, Google Fonts imports */
  headCss: string;
  /** Google Fonts stylesheets the page links */
  fontLinks: string[];
  /** every absolute or data: url the page uses (images, fonts, backgrounds), in first-seen order */
  urls: string[];
  report: ExtractReport;
}
