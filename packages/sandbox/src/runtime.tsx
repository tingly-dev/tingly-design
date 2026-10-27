/**
 * The artboard runtime: runs inside a sandboxed iframe, renders one
 * `.dc.html` with React, and turns pointer gestures into editor messages.
 *
 * In edit mode clicks select (they never reach the design's handlers),
 * double-click retypes literal text in place, and hover/selection outlines
 * are drawn here, inside the frame, so they line up at any canvas zoom.
 *
 * This file is the esbuild entry that bundles the runtime into one IIFE; the
 * concerns live beside it: stage.ts (the shared state), render.tsx (the
 * template renderer), scene.ts (a motion scene on the stage), overlay.ts
 * (the selection layer), drag.ts and resize.ts (the gestures, with
 * resize.ts's snapping), text.ts (in-place retype), inspect.ts (what the
 * panel is told about the selection), messages.ts (the frame's inbox) and
 * input.ts (the DOM event listeners).
 */
import { post } from './post';

// imports run their modules in order: state first, then the pieces that read
// it, the renderer, the inbox, and last the listeners that answer the pointer
import './stage';
import './overlay';
import './text';
import './scene';
import './render';
import './inspect';
import './messages';
import './input';

post({ dc: 'ready' });
