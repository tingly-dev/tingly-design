// The page rasterizer the browser export already uses, exposed for the bench (page and frames).
import { FrameRasterizer } from '../../packages/export/src/frames';
(globalThis as unknown as { __FR: typeof FrameRasterizer }).__FR = FrameRasterizer;
