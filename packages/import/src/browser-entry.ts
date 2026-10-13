import { extractPage } from './sources/html/extract';

// Everything that needs a live DOM, as one script a headless browser (the CLI)
// or a page can load: `window.dcExtract(window)` reads the laid-out page.
const w = window as unknown as { dcExtract: typeof extractPage };
w.dcExtract = extractPage;
