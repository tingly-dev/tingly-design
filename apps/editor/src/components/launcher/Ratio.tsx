import type { Size } from '../motion/motionSizes';

/** Draw the aspect ratio within a fixed 16px budget. */
export function Ratio({ size }: { size: Size }) {
  const k = 16 / Math.max(size[0], size[1]);
  return <i className="szratio" style={{ width: Math.max(4, Math.round(size[0] * k)), height: Math.max(4, Math.round(size[1] * k)) }} />;
}
