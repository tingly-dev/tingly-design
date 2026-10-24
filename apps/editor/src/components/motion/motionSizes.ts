/**
 * The sizes a person makes motion pieces in, kept in this browser: the one picked last (the next
 * new piece starts there) and the custom ones they have used, newest first. Presets are not stored.
 */
import { BOARD_SIZES, validSize } from '@dc/core';
import { readPref, writePref } from '../../local';

const KEY = 'dc.motionSizes';
const KEEP = 6;

export type Size = [number, number];
export interface MotionSizes {
  last: Size | null;
  mine: Size[];
}

export const sameSize = (a: Size | null, b: Size | null) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
export const isPreset = (s: Size) => BOARD_SIZES.some((p) => sameSize(p.size as unknown as Size, s));

export function readSizes(): MotionSizes {
  try {
    const raw = JSON.parse(readPref(KEY) || '{}');
    const mine = (Array.isArray(raw.mine) ? raw.mine : []).map(validSize).filter((s: Size | null): s is Size => !!s && !isPreset(s));
    return { last: validSize(raw.last), mine: mine.slice(0, KEEP) };
  } catch {
    return { last: null, mine: [] };
  }
}

function write(v: MotionSizes): void {
  writePref(KEY, JSON.stringify(v));
}

/** A size just used: the next piece starts here, and a custom one joins the person's own. */
export function rememberSize(size: Size): void {
  const v = readSizes();
  write({ last: size, mine: isPreset(size) ? v.mine : [size, ...v.mine.filter((s) => !sameSize(s, size))].slice(0, KEEP) });
}

export function forgetSize(size: Size): void {
  const v = readSizes();
  write({ last: sameSize(v.last, size) ? null : v.last, mine: v.mine.filter((s) => !sameSize(s, size)) });
}
