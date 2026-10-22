import type { FromRuntime } from '@dc/core';

/** Hands a message to the editor that holds this frame. */
export const post = (m: FromRuntime) => window.parent.postMessage(m, '*');
