import { BOARD_GROUPS, BOARD_SIZES, DEFAULT_BOARD_SIZE, parseBoardSize, type BoardGroup } from './boardSizes';
import { MOTION_SIZES, validSize } from './motion';
import { freeName } from './projectArchive';

/**
 * The questions `tingly-design new -i` asks, in the order of the New dialog: what kind, its title, where it lives, and
 * for a canvas or a motion piece the size (a canvas picks a category, then a size in it, as the dialog's lists do).
 * The flow is here so it can be tested without a terminal; the words are not: a question is an id the terminal
 * turns into a sentence, and an answer is raw text that is checked here.
 */
export const WIZARD_KINDS = ['canvas', 'slides', 'design-system', 'dashboard', 'doc', 'motion'] as const;

export const FOLDER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** A folder name from a title, when the title is plain enough to give one. */
export function slugOf(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|-+$/g, '')
    .slice(0, 64);
}

export type WizardSelect = 'kind' | 'group' | 'size' | 'format';
export type WizardText = 'title' | 'name' | 'custom';
/** Why an answer was not taken; the terminal says it in words and asks again. */
export type WizardComplaint = 'empty' | 'badName' | 'taken' | 'badSize' | 'badChoice';

export interface WizardIO {
  /** One of `options` (each a `value` the terminal can name); `initial` is what Enter picks. Returns raw text: a value, a 1-based number or nothing. */
  select(id: WizardSelect, options: readonly { value: string; size?: readonly [number, number] }[], initial: string): Promise<string>;
  /** Free text; empty means `initial` when there is one. */
  text(id: WizardText, initial?: string): Promise<string>;
  complain(why: WizardComplaint, params?: Record<string, string>): void;
}

export interface WizardGiven {
  kind?: string;
  title?: string;
  /** A name in the projects folder, or a path */
  target?: string;
  size?: [number, number];
}

export interface WizardAnswer {
  kind: (typeof WIZARD_KINDS)[number];
  title: string;
  target: string;
  size?: [number, number];
}

const isPath = (s: string) => /[/\\]/.test(s) || s.startsWith('.') || s.startsWith('~');

/** Which of the offered values the raw answer means: a number, a value, or Enter for the initial. */
function choose(options: readonly { value: string }[], initial: string, raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (!text) return initial;
  if (/^\d+$/.test(text)) return options[Number(text) - 1]?.value ?? null;
  return options.find((o) => o.value.toLowerCase() === text)?.value ?? null;
}

async function pick(io: WizardIO, id: WizardSelect, options: readonly { value: string; size?: readonly [number, number] }[], initial: string): Promise<string> {
  for (;;) {
    const v = choose(options, initial, await io.select(id, options, initial));
    if (v !== null) return v;
    io.complain('badChoice');
  }
}

async function customSize(io: WizardIO, from: readonly [number, number]): Promise<[number, number]> {
  for (;;) {
    const size = validSize(((await io.text('custom', `${from[0]}x${from[1]}`)).trim() || `${from[0]}x${from[1]}`).split(/[x×,]/i).map(Number));
    if (size) return size;
    io.complain('badSize');
  }
}

/**
 * Ask for what `given` leaves open. `taken` are the project names already in the projects folder.
 * A canvas's size is only asked when it is not given; the default is the dialog's (1200×760).
 */
export async function runNewWizard(io: WizardIO, given: WizardGiven, taken: ReadonlySet<string>): Promise<WizardAnswer> {
  const kind = (WIZARD_KINDS as readonly string[]).includes(given.kind ?? '') ? (given.kind as WizardAnswer['kind']) : ((await pick(io, 'kind', WIZARD_KINDS.map((value) => ({ value })), 'canvas')) as WizardAnswer['kind']);

  let title = given.title?.trim() ?? '';
  while (!title) {
    title = (await io.text('title')).trim();
    if (!title) io.complain('empty');
  }

  let target = given.target?.trim() ?? '';
  const suggested = freeName(slugOf(title) || kind, taken);
  while (!target) {
    const typed = (await io.text('name', suggested)).trim() || suggested;
    if (isPath(typed)) target = typed;
    else if (!FOLDER_NAME_RE.test(typed)) io.complain('badName');
    else if (taken.has(typed)) io.complain('taken', { name: typed });
    else target = typed;
  }

  let size = given.size;
  if (!size && kind === 'canvas') {
    const group = await pick(io, 'group', [...BOARD_GROUPS.map((value) => ({ value })), { value: 'custom' }], 'screen');
    if (group === 'custom') size = await customSize(io, DEFAULT_BOARD_SIZE);
    else {
      const options = BOARD_SIZES.filter((p) => p.group === (group as BoardGroup)).map((p) => ({ value: p.id as string, size: p.size }));
      const id = await pick(io, 'size', options, options[0].value);
      size = parseBoardSize(id) ?? undefined;
    }
  } else if (!size && kind === 'motion') {
    const options = [...MOTION_SIZES.map((p) => ({ value: p.name as string, size: p.size as readonly [number, number] })), { value: 'custom' }];
    const f = await pick(io, 'format', options, 'wide');
    size = f === 'custom' ? await customSize(io, [1920, 1080]) : (MOTION_SIZES.find((p) => p.name === f)!.size as unknown as [number, number]);
  }
  return { kind, title, target, ...(size ? { size } : {}) };
}
