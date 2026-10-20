import { validSize } from './motion';

/**
 * The artboard sizes a canvas offers by name: the New dialog's picker, the board panel's preset list and
 * the command line's `--size`, in groups by what the board is for. One list; to add or retire a size, change it here and give its two strings
 * in @dc/i18n (`canvas.boardSize.<id>` the name, `canvas.boardFor.<id>` where it is used), nothing else.
 * Platform sizes are the ones the platforms publish for posts and covers; they drift, so a size is one line to change.
 * Sizes are CSS pixels, the unit a canvas draws in.
 */
export const BOARD_GROUPS = ['screen', 'slides', 'social', 'ads', 'print'] as const;
export type BoardGroup = (typeof BOARD_GROUPS)[number];

export const BOARD_SIZES = [
  { id: 'artboard', group: 'screen', size: [1200, 760] },
  { id: 'desktop', group: 'screen', size: [1440, 900] },
  { id: 'mobile', group: 'screen', size: [390, 844] },
  { id: 'wide', group: 'slides', size: [1920, 1080] },
  { id: 'standard', group: 'slides', size: [1600, 1200] },
  { id: 'square', group: 'social', size: [1080, 1080] },
  { id: 'portrait', group: 'social', size: [1080, 1350] },
  { id: 'tall', group: 'social', size: [1080, 1440] },
  { id: 'story', group: 'social', size: [1080, 1920] },
  { id: 'wechat', group: 'social', size: [900, 383] },
  { id: 'og', group: 'social', size: [1200, 630] },
  { id: 'thumbnail', group: 'social', size: [1280, 720] },
  { id: 'pin', group: 'social', size: [1000, 1500] },
  { id: 'xheader', group: 'social', size: [1500, 500] },
  { id: 'linkedin', group: 'social', size: [1584, 396] },
  { id: 'fbcover', group: 'social', size: [851, 315] },
  { id: 'channelart', group: 'social', size: [2560, 1440] },
  { id: 'mpu', group: 'ads', size: [300, 250] },
  { id: 'leaderboard', group: 'ads', size: [728, 90] },
  { id: 'billboard', group: 'ads', size: [970, 250] },
  { id: 'halfpage', group: 'ads', size: [300, 600] },
  { id: 'skyscraper', group: 'ads', size: [160, 600] },
  { id: 'a4', group: 'print', size: [794, 1123] },
  { id: 'letter', group: 'print', size: [816, 1056] },
] as const satisfies readonly { id: string; group: BoardGroup; size: [number, number] }[];

export type BoardSizeId = (typeof BOARD_SIZES)[number]['id'];

/** What a new canvas's first artboard is when no size is asked for. */
export const DEFAULT_BOARD_SIZE: [number, number] = [1200, 760];

/** The preset whose size this is, if any. */
export function boardSizeOf(size: readonly number[] | null | undefined): (typeof BOARD_SIZES)[number] | undefined {
  return size ? BOARD_SIZES.find((p) => p.size[0] === size[0] && p.size[1] === size[1]) : undefined;
}

/** A size typed as `1080x1440` (`×` and `,` work too) or named by a preset id (`wechat`); null when it is neither or out of range. */
export function parseBoardSize(text: string): [number, number] | null {
  const word = text.trim().toLowerCase();
  const named = BOARD_SIZES.find((p) => p.id === word);
  if (named) return [named.size[0], named.size[1]];
  return /^\d+\s*[x×,]\s*\d+$/.test(word) ? validSize(word.split(/[x×,]/).map(Number)) : null;
}
