/**
 * What this browser remembers for the person (a view, a fold, a choice), and
 * files handed to them. Storage can be missing or refuse writes (private
 * mode, a sandboxed frame); then nothing is remembered and nothing breaks.
 */
import { catchFile } from './headless';

/** The remembered value under `key`, or '' when there is none or storage is unavailable. */
export function readPref(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/** Remember `value` under `key`; quietly does nothing when storage is unavailable. */
export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode: nothing to remember
  }
}

/** Hand the person a file from a URL that already is one (a data: or blob: URL the caller owns). */
export function downloadUrl(name: string, href: string): void {
  // the command line's export takes the file instead (headless.ts)
  if (catchFile(name, href)) return;
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
}

/** Hand the person a file made from text (of `type`) or a Blob. */
export function download(name: string, data: string | Blob, type = 'text/plain'): void {
  if (catchFile(name, typeof data === 'string' ? new Blob([data], { type }) : data)) return;
  const url = URL.createObjectURL(typeof data === 'string' ? new Blob([data], { type }) : data);
  downloadUrl(name, url);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
