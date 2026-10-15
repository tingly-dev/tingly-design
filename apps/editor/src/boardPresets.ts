/** The board sizes offered by name, for the board panel and the New dialog. `key` is a `panel.board.*` string taking `{w, h}`; no key means the label is the size's own name. */
export type BoardPresetKey = 'panel.board.presetPhone' | 'panel.board.presetDesktop' | 'panel.board.presetArtboard' | 'panel.board.presetSocial';

export const BOARD_PRESETS: { size: [number, number]; key?: BoardPresetKey; label?: string }[] = [
  { size: [390, 844], key: 'panel.board.presetPhone' },
  { size: [1280, 800], key: 'panel.board.presetDesktop' },
  { size: [1440, 900], key: 'panel.board.presetDesktop' },
  { size: [1200, 760], key: 'panel.board.presetArtboard' },
  { size: [1080, 1080], key: 'panel.board.presetSocial' },
  { size: [816, 1056], label: 'Letter 816 × 1056' },
  { size: [794, 1123], label: 'A4 794 × 1123' },
];

export const DEFAULT_BOARD_SIZE: [number, number] = [1200, 760];
