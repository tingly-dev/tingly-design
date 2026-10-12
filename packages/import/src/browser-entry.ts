import { extractPage } from './sources/html/extract';
import { parseSvg, readSvg } from './sources/svg/read';

// Everything that needs a live DOM, as one script a headless browser (the CLI)
// or a page can load: `window.dcExtract(window)` reads the laid-out page,
// `window.dcReadSvg(text)` reads an SVG document.
const w = window as unknown as { dcExtract: typeof extractPage; dcReadSvg: (text: string) => ReturnType<typeof readSvg> };
w.dcExtract = extractPage;
w.dcReadSvg = (text) => readSvg(parseSvg(text));
