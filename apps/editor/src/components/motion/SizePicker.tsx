import { BoardSizePicker } from '../launcher/BoardSizePicker';
import type { Size } from './motionSizes';

export { Ratio } from '../launcher/Ratio';

/** Motion uses the same grouped sizes as canvases and decks, plus saved custom sizes. */
export function SizePicker(props: { value: Size | null; onChange: (size: Size | null) => void }) {
  return <BoardSizePicker {...props} kind="motion" />;
}
