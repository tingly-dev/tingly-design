import { describe, expect, it } from 'vitest';
import { resources } from '../../i18n/src';
import { BOARD_GROUPS, BOARD_SIZES, DEFAULT_BOARD_SIZE, boardSizeOf, parseBoardSize, validSize } from '../src';

type Bundle = { canvas: { boardSize: Record<string, string>; boardFor: Record<string, string>; boardGroup: Record<string, string> } };
const en = resources.en.translation as unknown as Bundle;
const zh = resources.zh.translation as unknown as Bundle;

describe('BOARD_SIZES', () => {
  it('has unique ids and unique sizes, each a size a board can be', () => {
    expect(new Set(BOARD_SIZES.map((p) => p.id)).size).toBe(BOARD_SIZES.length);
    expect(new Set(BOARD_SIZES.map((p) => p.size.join('x'))).size).toBe(BOARD_SIZES.length);
    for (const p of BOARD_SIZES) expect(validSize(p.size)).toEqual([...p.size]);
  });

  it('names every size and says where it is used, in English and Chinese', () => {
    for (const p of BOARD_SIZES) {
      for (const lang of [en, zh]) {
        expect(lang.canvas.boardSize[p.id]?.trim(), `${p.id} name`).toBeTruthy();
        expect(lang.canvas.boardFor[p.id]?.trim(), `${p.id} note`).toBeTruthy();
      }
    }
    for (const g of BOARD_GROUPS) for (const lang of [en, zh]) expect(lang.canvas.boardGroup[g]?.trim(), `${g} group`).toBeTruthy();
    // every size is in a group that is listed, and every group has a size
    for (const p of BOARD_SIZES) expect(BOARD_GROUPS).toContain(p.group);
    for (const g of BOARD_GROUPS) expect(BOARD_SIZES.some((p) => p.group === g), g).toBe(true);
    // and no string is left for a size that is gone
    expect(Object.keys(en.canvas.boardSize).sort()).toEqual(BOARD_SIZES.map((p) => p.id).sort());
    expect(Object.keys(zh.canvas.boardFor).sort()).toEqual(BOARD_SIZES.map((p) => p.id).sort());
  });

  it('offers the default size, the WeChat cover and the common social sizes', () => {
    expect(boardSizeOf(DEFAULT_BOARD_SIZE)?.id).toBe('artboard');
    expect(BOARD_SIZES.find((p) => p.id === 'wechat')?.size).toEqual([900, 383]);
    expect(BOARD_SIZES.find((p) => p.id === 'tall')?.size).toEqual([1080, 1440]);
    expect(BOARD_SIZES.find((p) => p.id === 'story')?.size).toEqual([1080, 1920]);
    expect(BOARD_SIZES.find((p) => p.id === 'mpu')?.size).toEqual([300, 250]);
    expect(BOARD_SIZES.find((p) => p.id === 'og')?.size).toEqual([1200, 630]);
    expect(boardSizeOf([1, 2])).toBeUndefined();
  });

  it('has the WeChat and Chinese platform sizes, landscape and portrait', () => {
    const size = (id: string) => BOARD_SIZES.find((p) => p.id === id);
    expect([size('wxchannelh')?.size, size('wxchannelv')?.size]).toEqual([[1080, 608], [1080, 1260]]);
    expect(size('wxsub')?.size).toEqual([200, 200]);
    expect(size('wechat')?.group).toBe('wechat');
    expect(size('dycover')?.size).toEqual([1242, 1660]);
    expect(size('bilibili')?.group).toBe('cn');
    expect(size('wbcover')?.group).toBe('cn');
    expect(size('xheader')?.group).toBe('global');
  });
});

describe('parseBoardSize', () => {
  it('reads a name, case and space aside', () => {
    expect(parseBoardSize('wechat')).toEqual([900, 383]);
    expect(parseBoardSize(' A4 ')).toEqual([794, 1123]);
  });
  it('reads a width and height', () => {
    expect(parseBoardSize('1080x1440')).toEqual([1080, 1440]);
    expect(parseBoardSize('1080×1440')).toEqual([1080, 1440]);
    expect(parseBoardSize('1080,1440')).toEqual([1080, 1440]);
  });
  it('refuses the rest', () => {
    expect(parseBoardSize('nonsense')).toBeNull();
    expect(parseBoardSize('0x100')).toBeNull();
    expect(parseBoardSize('9000x100')).toBeNull();
    expect(parseBoardSize('')).toBeNull();
    expect(parseBoardSize('100x')).toBeNull();
  });
});
