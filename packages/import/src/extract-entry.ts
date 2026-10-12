import { extractPage } from './extract';

(window as unknown as { dcExtract: typeof extractPage }).dcExtract = extractPage;
