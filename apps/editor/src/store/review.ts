// The remarks of a review: written on the page, kept in this browser until they are sent.
// Pure: the types, the initial values and what is remembered; `review.ts` holds the actions.
import type { Remark } from '@dc/core';
import { readPref, writePref } from '../local';

export interface ReviewState {
  /** the project's unsent remarks, in the order they were made (their number is their place here) */
  remarks: Remark[];
  /** the remark being written: its card takes the keyboard and its pin wears a ring (`tick` asks again for the same one) */
  remarkFocus: { id: string; tick: number } | null;
}

export const reviewInitial = (): ReviewState => ({ remarks: [], remarkFocus: null });

const key = (project: string) => `dc.review.${project}`;

/** What this browser kept for the project: nothing when it is missing, damaged or from another shape. */
export function readRemarks(project: string): Remark[] {
  try {
    const list = JSON.parse(readPref(key(project)) || '[]') as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter((r): r is Remark => !!r && typeof r.id === 'string' && typeof r.file === 'string' && typeof r.text === 'string' && (r.tid === null || typeof r.tid === 'number'));
  } catch {
    return [];
  }
}

export function writeRemarks(project: string, remarks: Remark[]): void {
  writePref(key(project), remarks.length ? JSON.stringify(remarks) : '');
}
