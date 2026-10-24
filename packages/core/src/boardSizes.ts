/** The largest width or height a board, slide or motion format may have. */
export const MAX_FORMAT_PX = 7680;

/** A size usable for a board, slide or motion format, rounded, or null. */
export function validSize(size: unknown): [number, number] | null {
  if (!Array.isArray(size) || size.length !== 2) return null;
  const [w, h] = size.map((v) => Math.round(Number(v)));
  return w > 0 && h > 0 && w <= MAX_FORMAT_PX && h <= MAX_FORMAT_PX ? [w, h] : null;
}

/** The key a custom size gets in motion.json when its owner gives no name: `s1280x720`. */
export function sizeName(size: readonly number[]): string {
  return `s${size[0]}x${size[1]}`;
}


/**
 * The artboard sizes a canvas offers by name: the New dialog's picker, the board panel's preset list and
 * the command line's `--size`, in groups by what the board is for. One list; to add or retire a size, change it here and give its two strings
 * in @dc/i18n (`canvas.boardSize.<id>` the name, `canvas.boardFor.<id>` where it is used), nothing else.
 * A size motion.json already named (`wide`, `tall`, …) keeps that key in `format`; every other size is `s<w>x<h>` there. Platform sizes are the ones the platforms publish for posts and covers; they drift, so a size is one line to change.
 * Sizes are CSS pixels, the unit a canvas draws in.
 */
export const BOARD_GROUPS = ['screen', 'device', 'slides', 'social', 'ads', 'print', 'ratio'] as const;
export type BoardGroup = (typeof BOARD_GROUPS)[number];

export const BOARD_SIZES = [
  { id: 'artboard', group: 'screen', size: [1200, 760] },
  { id: 'desktop', group: 'screen', size: [1440, 900] },
  { id: 'mobile', group: 'screen', size: [390, 844] },
  { id: 'iphonese', group: 'device', size: [375, 667] },
  { id: 'iphone15', group: 'device', size: [393, 852] },
  { id: 'iphonemax', group: 'device', size: [430, 932] },
  { id: 'pixel', group: 'device', size: [412, 915] },
  { id: 'galaxys8', group: 'device', size: [360, 740] },
  { id: 'galaxyfold', group: 'device', size: [280, 653] },
  { id: 'ipadmini', group: 'device', size: [768, 1024] },
  { id: 'ipadair', group: 'device', size: [820, 1180] },
  { id: 'ipadpro11', group: 'device', size: [834, 1194] },
  { id: 'ipadpro', group: 'device', size: [1024, 1366] },
  { id: 'nesthub', group: 'device', size: [1024, 600] },
  { id: 'laptop', group: 'device', size: [1366, 768] },
  { id: 'macbook14', group: 'device', size: [1512, 982] },
  { id: 'macbook16', group: 'device', size: [1728, 1117] },
  { id: 'bilibili', group: 'social', size: [1146, 717] },
  { id: 'xpost', group: 'social', size: [1600, 900] },
  { id: 'igland', group: 'social', size: [1080, 566] },
  { id: 'wide', group: 'slides', size: [1920, 1080], format: 'wide' },
  { id: 'standard', group: 'slides', size: [1600, 1200] },
  { id: 'square', group: 'social', size: [1080, 1080], format: 'square' },
  { id: 'portrait', group: 'social', size: [1080, 1350], format: 'portrait' },
  { id: 'tall', group: 'social', size: [1080, 1440], format: 'upright' },
  { id: 'story', group: 'social', size: [1080, 1920], format: 'tall' },
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
  { id: 'classic', group: 'ratio', size: [1440, 1080], format: 'classic' },
  { id: 'landscape32', group: 'ratio', size: [1620, 1080] },
  { id: 'portrait23', group: 'ratio', size: [1080, 1620] },
  { id: 'landscape21', group: 'ratio', size: [2160, 1080] },
  { id: 'portrait12', group: 'ratio', size: [1080, 2160] },
  { id: 'ultrawide', group: 'ratio', size: [2520, 1080] },
  { id: 'cinema', group: 'ratio', size: [2580, 1080] },
  { id: 'wide1610', group: 'ratio', size: [1920, 1200] },
] as const satisfies readonly { id: string; group: BoardGroup; size: [number, number]; format?: string }[];

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

/** The key a size gets as a motion format: the legacy name of the six sizes motion.json has always used (`tall`), else `s1280x720`. */
export function formatNameOf(size: readonly number[]): string {
  const p = boardSizeOf(size);
  return (p && 'format' in p && p.format) || sizeName(size);
}
