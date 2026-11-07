/**
 * An animated GIF as data: read the file, compose its frames, and say which
 * frame a given moment shows. No DOM and no network, so the motion runtime,
 * the tests and a server check read a GIF the same way (see .design/gif-images.md).
 *
 *   parseGif(bytes)      → size, loop count and the frames as patches (cheap)
 *   composeGif(info)     → the full frames in order, one buffer reused
 *   gifFrameAt(...)      → the frame index at `ms` after the picture came on screen
 */

/** Why a file was not read: the code is the whole message, the editor words it. */
export class GifError extends Error {
  constructor(readonly code: 'not-gif' | 'truncated' | 'bad-data' | 'too-large') {
    super(code);
  }
}

export interface GifLimits {
  /** width × height of the logical screen */
  maxPixels: number;
  /** pixels × frames: what composing every frame as RGBA could hold at once */
  maxTotalPixels: number;
  maxFrames: number;
}

export const GIF_LIMITS: GifLimits = { maxPixels: 16_000_000, maxTotalPixels: 120_000_000, maxFrames: 1500 };

/** One image of the file, as the file holds it: a rectangle of the screen, not yet composed. */
export interface GifPatch {
  left: number;
  top: number;
  width: number;
  height: number;
  /** RGBA of the rectangle */
  rgba: Uint8ClampedArray;
  /** how long it stays, in ms (a missing or tiny delay is 100 ms, as browsers draw it) */
  delay: number;
  /** 0/1 leave it, 2 clear its rectangle, 3 put back what was there before */
  disposal: number;
}

export interface GifInfo {
  width: number;
  height: number;
  /** repeats after the first play: 0 forever, -1 the file has no loop block (played once), N plays N more times */
  loops: number;
  frames: GifPatch[];
}

export function isGif(b: Uint8Array): boolean {
  return b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61;
}

/** The delay a browser draws: under 20 ms is taken as 100 ms (the web's long habit, so old GIFs keep their pace). */
const delayOf = (cs: number) => (cs < 2 ? 100 : cs * 10);

/** Unpack the LZW stream of one image into palette indexes. */
function lzw(data: Uint8Array, minCode: number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  const clear = 1 << minCode;
  const end = clear + 1;
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  let size = minCode + 1;
  let mask = (1 << size) - 1;
  let next = end + 1;
  let prev = -1;
  let first = 0;
  let bits = 0;
  let acc = 0;
  let at = 0;
  let o = 0;
  for (let i = 0; i < clear; i++) suffix[i] = i;
  while (o < count) {
    while (bits < size) {
      if (at >= data.length) return out;
      acc |= data[at++] << bits;
      bits += 8;
    }
    let code = acc & mask;
    acc >>>= size;
    bits -= size;
    if (code === clear) {
      size = minCode + 1;
      mask = (1 << size) - 1;
      next = end + 1;
      prev = -1;
      continue;
    }
    if (code === end) break;
    if (prev === -1) {
      if (code >= clear) throw new GifError('bad-data');
      out[o++] = suffix[code];
      prev = code;
      first = code;
      continue;
    }
    const inCode = code;
    let sp = 0;
    if (code >= next) {
      if (code > next) throw new GifError('bad-data');
      stack[sp++] = first;
      code = prev;
    }
    while (code >= clear) {
      if (sp >= 4096) throw new GifError('bad-data');
      stack[sp++] = suffix[code];
      code = prefix[code];
    }
    first = suffix[code];
    stack[sp++] = first;
    if (next < 4096) {
      prefix[next] = prev;
      suffix[next] = first;
      next++;
      if ((next & mask) === 0 && next < 4096) {
        size++;
        mask = (1 << size) - 1;
      }
    }
    prev = inCode;
    while (sp > 0 && o < count) out[o++] = stack[--sp];
  }
  return out;
}

/** Read the file's structure and every image's pixels; throws GifError when it is not a GIF it can hold. */
export function parseGif(b: Uint8Array, limits: GifLimits = GIF_LIMITS): GifInfo {
  if (!isGif(b)) throw new GifError('not-gif');
  if (b.length < 13) throw new GifError('truncated');
  const u16 = (p: number) => b[p] | (b[p + 1] << 8);
  const width = u16(6);
  const height = u16(8);
  if (!width || !height || width * height > limits.maxPixels) throw new GifError('too-large');
  let p = 13;
  let globalColors: Uint8Array | null = null;
  if (b[10] & 0x80) {
    const n = 3 << ((b[10] & 7) + 1);
    if (p + n > b.length) throw new GifError('truncated');
    globalColors = b.subarray(p, p + n);
    p += n;
  }
  const frames: GifPatch[] = [];
  let loops = -1;
  let delay = 100;
  let disposal = 0;
  let transparent = -1;
  /** the data sub-blocks from `p`, joined; leaves `p` after the terminator */
  const blocks = (): Uint8Array => {
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      if (p >= b.length) throw new GifError('truncated');
      const n = b[p++];
      if (!n) break;
      if (p + n > b.length) throw new GifError('truncated');
      parts.push(b.subarray(p, p + n));
      total += n;
      p += n;
    }
    if (parts.length === 1) return parts[0];
    const all = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      all.set(part, at);
      at += part.length;
    }
    return all;
  };
  while (p < b.length) {
    const tag = b[p++];
    if (tag === 0x3b) break;
    if (tag === 0x21) {
      const label = b[p++];
      if (label === 0xf9 && b[p] >= 4) {
        const flags = b[p + 1];
        disposal = (flags >> 2) & 7;
        delay = delayOf(u16(p + 2));
        transparent = flags & 1 ? b[p + 4] : -1;
      }
      const data = blocks();
      if (label === 0xff && data.length >= 14 && String.fromCharCode(...data.subarray(0, 11)) === 'NETSCAPE2.0' && data[11] === 1) loops = data[12] | (data[13] << 8);
      continue;
    }
    if (tag !== 0x2c) throw new GifError('bad-data');
    if (p + 9 > b.length) throw new GifError('truncated');
    const left = u16(p);
    const top = u16(p + 2);
    const w = u16(p + 4);
    const h = u16(p + 6);
    const flags = b[p + 8];
    p += 9;
    let colors = globalColors;
    if (flags & 0x80) {
      const n = 3 << ((flags & 7) + 1);
      if (p + n > b.length) throw new GifError('truncated');
      colors = b.subarray(p, p + n);
      p += n;
    }
    const minCode = b[p++];
    if (minCode < 1 || minCode > 8) throw new GifError('bad-data');
    if (w * h > limits.maxPixels) throw new GifError('too-large');
    if (frames.length + 1 > limits.maxFrames || (frames.length + 1) * width * height > limits.maxTotalPixels) throw new GifError('too-large');
    const data = blocks();
    const index = lzw(data, minCode, w * h);
    const rgba = new Uint8ClampedArray(w * h * 4);
    const palette = colors ?? new Uint8Array(0);
    const rows = flags & 0x40 ? interlaced(h) : null;
    for (let y = 0; y < h; y++) {
      const row = rows ? rows[y] : y;
      for (let x = 0; x < w; x++) {
        const k = index[y * w + x];
        const q = (row * w + x) * 4;
        if (k === transparent || k * 3 + 2 >= palette.length) continue;
        rgba[q] = palette[k * 3];
        rgba[q + 1] = palette[k * 3 + 1];
        rgba[q + 2] = palette[k * 3 + 2];
        rgba[q + 3] = 255;
      }
    }
    frames.push({ left, top, width: w, height: h, rgba, delay, disposal });
    delay = 100;
    disposal = 0;
    transparent = -1;
  }
  if (!frames.length) throw new GifError('bad-data');
  return { width, height, loops, frames };
}

/** Output row of each stored row of an interlaced image (four passes). */
function interlaced(h: number): number[] {
  const rows: number[] = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]] as const) for (let y = start; y < h; y += step) rows.push(y);
  return rows;
}

/**
 * The picture after each image is drawn, in order. The yielded buffer is
 * reused: copy it (or draw it) before asking for the next.
 */
export function* composeGif(info: GifInfo): Generator<{ index: number; delay: number; rgba: Uint8ClampedArray }> {
  const { width, height } = info;
  const screen = new Uint8ClampedArray(width * height * 4);
  let before: Uint8ClampedArray | null = null;
  let last: GifPatch | null = null;
  for (let index = 0; index < info.frames.length; index++) {
    // what the previous image asked for happens before this one is drawn
    if (last) {
      if (last.disposal === 2) clearRect(screen, width, height, last);
      else if (last.disposal === 3 && before) screen.set(before);
    }
    const f = info.frames[index];
    before = f.disposal === 3 ? screen.slice() : null;
    for (let y = 0; y < f.height; y++) {
      const sy = f.top + y;
      if (sy >= height) break;
      for (let x = 0; x < f.width; x++) {
        const sx = f.left + x;
        if (sx >= width) break;
        const q = (y * f.width + x) * 4;
        if (!f.rgba[q + 3]) continue;
        const s = (sy * width + sx) * 4;
        screen[s] = f.rgba[q];
        screen[s + 1] = f.rgba[q + 1];
        screen[s + 2] = f.rgba[q + 2];
        screen[s + 3] = 255;
      }
    }
    last = f;
    yield { index, delay: f.delay, rgba: screen };
  }
}

function clearRect(screen: Uint8ClampedArray, width: number, height: number, r: GifPatch) {
  for (let y = r.top; y < Math.min(height, r.top + r.height); y++) screen.fill(0, (y * width + r.left) * 4, (y * width + Math.min(width, r.left + r.width)) * 4);
}

/** How a picture plays when put on a timeline: the file's own count, or one of the two the author may ask for. */
export type GifPlay = 'file' | 'loop' | 'once';

/**
 * The image to show `ms` after the picture came on screen. Before it: the first.
 * When the plays are used up: the last, held. A forever loop never ends.
 */
export function gifFrameAt(delays: readonly number[], loops: number, ms: number, play: GifPlay = 'file'): number {
  const total = delays.reduce((a, d) => a + d, 0);
  if (delays.length < 2 || total <= 0 || ms <= 0) return 0;
  const repeats = play === 'loop' ? 0 : play === 'once' ? -1 : loops;
  let t = ms;
  if (repeats === 0) t %= total;
  else if (t >= total * (repeats + 1)) return delays.length - 1;
  else t %= total;
  for (let i = 0; i < delays.length; i++) {
    if (t < delays[i]) return i;
    t -= delays[i];
  }
  return delays.length - 1;
}
