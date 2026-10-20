/**
 * Built-in shader effects (`<x-embed data-fx="…" data-seek>`): a preset name
 * and its values in one attribute, turned into the embed's markup (a canvas,
 * a GLSL ES 3.0 fragment shader and the WebGL2 runtime) by whoever draws the
 * embed: the motion player and renderer, the editing stage, a slide. When
 * WebGL2 cannot start, the runtime draws the preset's CSS stand-in instead,
 * which is also a function of time. See .design/motion-effects.md.
 *
 *   data-fx="edge-glow; box: 760x460 @50% 42%; radius: 36; colors: #3d7bff #9861ff"
 */

export const FX_PRESETS = [
  'flow', 'aurora', 'mesh', 'plasma', 'waves', 'grid', 'stars', 'halftone',
  'edge-glow', 'sweep', 'rays', 'ripple', 'particles', 'light-leak', 'scanlines', 'grain',
] as const;
export type FxPreset = (typeof FX_PRESETS)[number];

/** Tingly's brand family: blue, violet, pink, amber. */
const BRAND = ['#3d7bff', '#9861ff', '#ff6fa3', '#ffad66'];

/** How a preset draws itself where WebGL2 is off (the runtime's `paint`). */
type Fallback = 'field' | 'aurora' | 'edge' | 'sweep' | 'leak' | 'none';

interface PresetSpec {
  /** the values this preset reads, besides `quality` and `region` which every preset takes */
  keys: string[];
  colors: string[];
  background?: string;
  amount: number;
  /** share of the layer's device pixels the shader draws */
  quality: number;
  /** degrees, for the presets that drift (`direction`) */
  direction?: number;
  fallback: Fallback;
  /** `vec4 fx()`: the premultiplied colour of this pixel */
  body: string;
}

export interface FxBox {
  w: number;
  h: number;
  /** centre, in % of the embed */
  cx: number;
  cy: number;
}

export interface FxSpec {
  preset: FxPreset;
  colors: string[];
  background: string;
  speed: number;
  amount: number;
  quality: number;
  box: FxBox;
  radius: number;
  /** seconds */
  every: number;
  /** degrees */
  angle: number;
  /** how large the pattern is: 2 draws it twice as big */
  scale: number;
  /** degrees the pattern drifts towards: 0 right, 90 down, 270 up */
  direction: number;
  /** the point rays, ripples and stars come from, in % of the embed */
  center: [number, number];
  /** the part of the embed drawn, in %: left, top, width, height */
  region: [number, number, number, number];
  fallback: Fallback;
}

// ------------------------------------------------------------------ GLSL

const HEADER = `#version 300 es
precision highp float;
uniform float time;
uniform float u_aspect;
uniform vec2 u_size;
in vec2 v_uv;
out vec4 color;
// the region's own frame, set by main: a preset draws into it as if it were the whole embed
vec2 uv;
float aspect;
vec2 size;
`;

const LIB = `
// integer hash (PCG): the same noise on every GPU and software renderer
uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float hash(ivec2 p) { return float(pcg(uint(p.x & 0x7fffffff) ^ pcg(uint(p.y & 0x7fffffff) + 0x9e3779b9u))) / 4294967295.0; }
vec2 hash2(ivec2 p) { return vec2(hash(p), hash(p + ivec2(9187, 3121))); }
float vnoise(vec2 p) {
  ivec2 i = ivec2(floor(p)); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + ivec2(1, 0)), f.x), mix(hash(i + ivec2(0, 1)), hash(i + ivec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int k = 0; k < 4; k++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.0; a *= 0.5; } return s; }
// the colours one after another along x, softly
vec3 pal(float x) { float n = float(NC); x = fract(x / n) * n; int i = int(floor(x)); return mix(COL[i], COL[(i + 1) % NC], smoothstep(0.0, 1.0, fract(x))); }
// a point in units of the frame's short side around c (uv, top-left origin), the same in every format
vec2 sp(vec2 c) { return (uv - c) * vec2(aspect, 1.0) / min(aspect, 1.0); }
// the same point in a drifting, scaled pattern: what a field samples
vec2 fp(vec2 c) { return (sp(c) - DIR * time * 0.05 * SPEED) / SCALE; }
float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float dither() { return (hash(ivec2(gl_FragCoord.xy)) - 0.5) / 255.0; }
vec4 opaque(vec3 c) { return vec4(clamp(c + dither(), 0.0, 1.0), 1.0); }
// light on its own: as bright as it is opaque, so it adds over what is under it
vec4 light(vec3 c) { c = min(c, vec3(1.0)); return vec4(c, max(c.r, max(c.g, c.b))); }
`;

// every preset's main: the preset fitted into the region, its edge soft
const MAIN = `
void main() {
  uv = (v_uv - REGION.xy) / REGION.zw;
  aspect = u_aspect * REGION.z / REGION.w;
  size = u_size * REGION.zw;
  vec2 lo = REGION.xy, hi = REGION.xy + REGION.zw, e = vec2(0.012) / vec2(u_aspect, 1.0) * min(u_aspect, 1.0);
  vec2 m = smoothstep(lo - e, lo + e, v_uv) * (1.0 - smoothstep(hi - e, hi + e, v_uv));
  float inside = REGION.z >= 1.0 && REGION.w >= 1.0 && REGION.x <= 0.0 && REGION.y <= 0.0 ? 1.0 : m.x * m.y;
  color = inside > 0.0 ? fx() * inside : vec4(0.0);
}`;

const FIELD = ['colors', 'background', 'speed', 'amount', 'scale', 'direction'];

const PRESETS: Record<FxPreset, PresetSpec> = {
  // ink-like currents of colour folding into each other on a dark frame: a background
  flow: {
    keys: FIELD,
    colors: ['#2663eb', '#854df2', '#ff8f75'],
    background: '#05070f',
    amount: 1,
    quality: 0.5,
    fallback: 'field',
    body: `vec4 fx() {
  float t = time * 0.22 * SPEED;
  vec2 p = fp(vec2(0.0)) * 1.8;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + 0.6 * t), fbm(p + 3.0 * q + vec2(8.3, 2.8) - 0.4 * t));
  float f = fbm(p + 3.0 * r);
  vec3 c = mix(BG, COL[0], clamp(f * f * 2.4, 0.0, 1.0) * AMOUNT);
  c = mix(c, COL[1 % NC], clamp(length(q) * 0.7 - 0.2, 0.0, 1.0) * 0.55 * AMOUNT);
  c = mix(c, COL[2 % NC], clamp(r.x * r.x * 1.6 - 0.35, 0.0, 1.0) * 0.75 * AMOUNT);
  c *= 1.0 - 0.55 * distance(uv, vec2(0.5));
  return opaque(c);
}`,
  },
  // curtains of light drifting across the top of a dark frame: a background
  aurora: {
    keys: ['colors', 'background', 'speed', 'amount', 'scale'],
    colors: BRAND.slice(0, 3),
    background: '#07080f',
    amount: 1,
    quality: 0.5,
    fallback: 'aurora',
    body: `vec4 fx() {
  vec2 p = sp(vec2(0.5));
  float t = time * 0.06 * SPEED;
  vec3 c = BG;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float x = p.x * 0.9 / SCALE + fk * 1.7;
    float y = p.y + 0.16 - fk * 0.13 + (fbm(vec2(x + t * (1.0 + fk * 0.3), fk * 4.0 + t * 0.4)) - 0.5) * 0.6;
    // a bright lower edge that fades slowly upwards
    float curtain = y > 0.0 ? exp(-y * 38.0) : exp(y * 5.0);
    float rays = 0.5 + 0.5 * vnoise(vec2(x * 14.0, t * 3.0 + fk * 9.0));
    c += pal(fk * 0.9 + p.x * 0.25 + t * 2.0) * curtain * rays * 0.42 * AMOUNT;
  }
  c *= 1.0 - 0.3 * dot(p, p);
  return opaque(c);
}`,
  },
  // soft fields of the colours drifting into each other: a background
  mesh: {
    keys: ['colors', 'background', 'speed', 'amount', 'scale'],
    colors: BRAND,
    background: '#07080f',
    amount: 0.85,
    quality: 0.5,
    fallback: 'field',
    body: `vec4 fx() {
  vec2 p = sp(vec2(0.5)) / SCALE;
  vec2 e = 0.5 * vec2(aspect, 1.0) / min(aspect, 1.0) / SCALE;
  float t = time * 0.12 * SPEED;
  p += 0.12 * (vec2(vnoise(p * 2.0 + t), vnoise(p * 2.0 - t + 5.0)) - 0.5);
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    vec2 c = e * 0.8 * vec2(sin(t * (1.0 + 0.37 * fk) + fk * 1.9), cos(t * (0.8 + 0.29 * fk) + fk * 2.7));
    vec2 d = p - c;
    float w = exp(-dot(d, d) * 3.5) + 1e-4;
    acc += pal(fk) * w; ws += w;
  }
  return opaque(mix(BG, acc / ws, AMOUNT * (1.0 - 0.25 * dot(p, p))));
}`,
  },
  // bands of the colours bending through each other, brighter than mesh: a background
  plasma: {
    keys: FIELD,
    colors: BRAND,
    background: '#07080f',
    amount: 0.9,
    quality: 0.5,
    fallback: 'field',
    body: `vec4 fx() {
  vec2 p = fp(vec2(0.5)) * 3.0;
  float t = time * 0.35 * SPEED;
  float v = sin(p.x + t) + sin(0.8 * p.y - 0.7 * t) + sin(0.6 * (p.x + p.y) + 0.5 * t);
  v += sin(length(p + vec2(sin(t * 0.3), cos(t * 0.4)) * 1.5) * 1.7 - t);
  vec3 c = pal(v * 0.5 * float(NC) / 2.0 + t * 0.1);
  c *= 0.75 + 0.25 * sin(v * 3.14159);
  return opaque(mix(BG, c, AMOUNT * (1.0 - 0.3 * distance(uv, vec2(0.5)))));
}`,
  },
  // contour lines of a slowly changing landscape, like a topographic map: a background
  waves: {
    keys: FIELD,
    colors: ['#3d7bff', '#9861ff'],
    background: '#07080f',
    amount: 1,
    quality: 1,
    direction: 0,
    fallback: 'field',
    body: `vec4 fx() {
  vec2 p = fp(vec2(0.5)) * 2.2;
  float t = time * 0.08 * SPEED;
  float h = fbm(p + vec2(t, -t * 0.7)) + 0.35 * fbm(p * 2.0 - t);
  float n = h * 14.0, d = abs(fract(n) - 0.5) / fwidth(n);
  float line = 1.0 - smoothstep(0.0, 2.0, d);
  // every fifth line a little brighter, as on a map
  float major = step(4.5, mod(floor(n + 0.5), 5.0));
  vec3 c = BG + pal(h * 2.0 + t) * line * (0.6 + 0.5 * major) * AMOUNT;
  return opaque(c * (1.0 - 0.35 * distance(uv, vec2(0.5))));
}`,
  },
  // a perspective floor grid rolling towards the viewer under a glowing horizon: a background
  grid: {
    keys: ['colors', 'background', 'speed', 'amount', 'scale'],
    colors: ['#ff6fa3', '#9861ff'],
    background: '#07050f',
    amount: 1,
    quality: 1,
    fallback: 'field',
    body: `vec4 fx() {
  float hz = 0.58;
  vec3 c = BG + COL[1 % NC] * exp(-abs(uv.y - hz) * 9.0) * 0.55 * AMOUNT;
  // the floor below the horizon, seen in perspective; worked out everywhere so the derivatives hold
  float z = 0.25 / max(uv.y - hz, 0.002);
  vec2 g = vec2((uv.x - 0.5) * aspect * z, z + time * 0.6 * SPEED) * 4.0 / SCALE;
  vec2 w = min(fwidth(g), vec2(0.5));
  vec2 l = smoothstep(1.0 - w * 2.0, vec2(1.0), 1.0 - abs(fract(g) - 0.5) * 2.0);
  c += COL[0] * max(l.x, l.y) * exp(-z * 0.35) * step(hz, uv.y) * AMOUNT;
  return opaque(c);
}`,
  },
  // stars streaming out of a point, as if the camera flew forward: a background
  stars: {
    keys: ['colors', 'background', 'speed', 'amount', 'at'],
    colors: ['#ffffff', '#9fc2ff'],
    background: '#03040a',
    amount: 1,
    quality: 1,
    fallback: 'field',
    body: `vec4 fx() {
  vec2 p = sp(AT);
  vec3 c = BG;
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    // each layer comes closer and is replaced by a far one: depth runs 0 → 1 and wraps
    float d = fract(fk * 0.25 + time * 0.08 * SPEED);
    float zoom = mix(14.0, 0.6, d);
    vec2 q = p * zoom + fk * 13.7;
    ivec2 cell = ivec2(floor(q));
    // kept off the cell's edges, so a near star's glow fades out before the next cell cuts it
    vec2 o = 0.2 + 0.6 * hash2(cell + ivec2(k * 101));
    vec2 r = fract(q) - o;
    float star = exp(-dot(r, r) * mix(900.0, 200.0, d)) * smoothstep(0.0, 0.3, d) * smoothstep(1.0, 0.85, d);
    c += pal(hash(cell) * float(NC)) * star * (0.4 + 0.6 * hash(cell + ivec2(7))) * 1.4 * AMOUNT;
  }
  return opaque(c);
}`,
  },
  // a grid of dots whose size follows a drifting field, like print: a background
  halftone: {
    keys: FIELD,
    colors: ['#3d7bff', '#ff6fa3'],
    background: '#07080f',
    amount: 1,
    quality: 1,
    direction: 315,
    fallback: 'field',
    body: `vec4 fx() {
  vec2 p = sp(vec2(0.5));
  float cells = 46.0 / SCALE;
  vec2 g = p * cells;
  vec2 cid = floor(g) + 0.5;
  vec2 at = cid / cells + DIR * time * 0.05 * SPEED * -1.0;
  float v = fbm(at * 2.2 + time * 0.05 * SPEED);
  float r = smoothstep(0.3, 0.75, v) * 0.48;
  float d = length(g - cid);
  float dot_ = 1.0 - smoothstep(r - 0.06, r + 0.06, d);
  vec3 c = mix(BG, pal(v * 2.0), dot_ * AMOUNT);
  return opaque(c);
}`,
  },
  // light flowing around a box (a card that is working): a layer under the card
  'edge-glow': {
    keys: ['colors', 'speed', 'amount', 'box', 'radius'],
    colors: BRAND,
    amount: 1,
    quality: 1,
    fallback: 'edge',
    body: `vec4 fx() {
  float s = min(size.x, size.y);
  vec2 p = sp(BOX_C);
  float d = sdRound(p, BOX_H / s, BOX_R / s);
  float ang = atan(p.y, p.x) / 6.2831853;
  float t = time * SPEED;
  vec3 col = pal(ang * float(NC) + t * 0.24);
  // light only outside the box (the card it wraps covers the inside anyway); the rim sits on the edge
  float o = max(d, 0.0), outside = smoothstep(-0.002, 0.004, d);
  // two slow waves multiplied: the light breathes unevenly along the edge, as if it flowed
  float flow = 0.6 + 0.4 * sin(ang * 18.85 - t * 1.4) * sin(ang * 6.28 + t * 0.7);
  float rim = exp(-abs(d) * 260.0);
  float glow = exp(-o * (26.0 - 10.0 * flow)) * 0.55 * flow;
  float bloom = exp(-o * 5.0) * 0.10;
  return light(col * (rim * 0.85 + (glow + bloom) * outside) * AMOUNT);
}`,
  },
  // a band of light crossing the frame once every few seconds: a layer over a title
  sweep: {
    keys: ['colors', 'speed', 'amount', 'every', 'angle'],
    colors: ['#ffffff'],
    amount: 0.35,
    quality: 0.5,
    fallback: 'sweep',
    body: `vec4 fx() {
  vec2 p = sp(vec2(0.5));
  float a = radians(ANGLE);
  float s = dot(p, vec2(cos(a), sin(a)));
  float reach = 0.5 * length(vec2(aspect, 1.0) / min(aspect, 1.0)) + 0.25;
  // crosses in the first 60 % of each period, then rests out of frame
  float ph = fract(time * SPEED / EVERY);
  float at = mix(-reach, reach, smoothstep(0.0, 0.6, ph));
  float x = s - at;
  float i = (exp(-x * x * 120.0) * 0.6 + exp(-x * x * 2000.0) * 0.5) * AMOUNT;
  return vec4(COL[0] * i, i);
}`,
  },
  // shafts of light falling from a point, slowly turning: a layer over a background
  rays: {
    keys: ['colors', 'speed', 'amount', 'at'],
    colors: ['#ffe2b8', '#9fc2ff'],
    amount: 0.6,
    quality: 0.5,
    fallback: 'none',
    body: `vec4 fx() {
  vec2 p = sp(AT);
  float r = length(p), a = atan(p.y, p.x);
  float t = time * 0.12 * SPEED;
  // noise around the circle, read on a ring so it closes up
  vec2 ring = vec2(cos(a), sin(a)) * 3.0;
  float shafts = pow(fbm(ring + vec2(t, -t)), 2.0) * 1.6 + 0.6 * pow(vnoise(ring * 3.0 - t * 2.0), 3.0);
  float fall = exp(-r * 1.3) * smoothstep(0.0, 0.08, r + 0.02);
  return light(pal(r * 1.5 + t) * shafts * fall * 1.4 * AMOUNT + COL[0] * exp(-r * 9.0) * 0.5 * AMOUNT);
}`,
  },
  // rings of light spreading from a point, one every period: a layer behind a mark or a button
  ripple: {
    keys: ['colors', 'speed', 'amount', 'scale', 'at', 'every'],
    colors: ['#3d7bff', '#9861ff'],
    amount: 0.8,
    quality: 1,
    fallback: 'none',
    body: `vec4 fx() {
  float r = length(sp(AT)) / SCALE;
  vec3 c = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    // three rings in flight, a third of a period apart
    float ph = fract(time * SPEED / EVERY + float(k) / 3.0);
    float at = ph * 0.9;
    float ring = exp(-pow((r - at) * 70.0, 2.0)) + 0.35 * exp(-pow((r - at) * 18.0, 2.0));
    c += pal(float(k)) * ring * (1.0 - ph) * (1.0 - ph);
  }
  return light(c * AMOUNT);
}`,
  },
  // soft points of light drifting slowly, twinkling: a layer over a background
  particles: {
    keys: ['colors', 'speed', 'amount', 'scale', 'direction'],
    colors: ['#ffffff', '#9fc2ff', '#ffad66'],
    amount: 0.9,
    quality: 1,
    direction: 270,
    fallback: 'none',
    body: `vec4 fx() {
  vec3 c = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    // two depths: the far one smaller, slower and dimmer
    float fk = float(k), depth = 1.0 + fk * 0.8;
    vec2 q = (sp(vec2(0.5)) - DIR * time * 0.06 * SPEED / depth) / SCALE * 9.0 * depth + fk * 31.0;
    ivec2 base = ivec2(floor(q));
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      ivec2 cell = base + ivec2(i, j);
      vec2 o = hash2(cell + ivec2(k * 57));
      // a gentle sway, each dot its own
      o += 0.15 * vec2(sin(time * 0.6 * SPEED + o.y * 6.28), cos(time * 0.5 * SPEED + o.x * 6.28));
      vec2 d = q - (vec2(cell) + o);
      float size = mix(0.05, 0.16, hash(cell + ivec2(3))) / depth;
      float twinkle = 0.55 + 0.45 * sin(time * (1.0 + 2.0 * hash(cell + ivec2(11))) * SPEED + o.x * 20.0);
      float b = exp(-dot(d, d) / (size * size)) * twinkle * step(0.35, hash(cell + ivec2(5)));
      c += pal(hash(cell + ivec2(17)) * float(NC)) * b / depth;
    }
  }
  return light(c * AMOUNT);
}`,
  },
  // warm light spilling in from the edges, as from a lens: a layer over everything
  'light-leak': {
    keys: ['colors', 'speed', 'amount'],
    colors: ['#ff8f3d', '#ff4f7a', '#ffd27a'],
    amount: 0.55,
    quality: 0.5,
    fallback: 'leak',
    body: `vec4 fx() {
  vec2 p = sp(vec2(0.5));
  vec2 e = 0.5 * vec2(aspect, 1.0) / min(aspect, 1.0);
  float t = time * 0.1 * SPEED;
  vec3 c = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    // each blob wanders along the frame's edge
    float a = t * (0.6 + 0.3 * fk) + fk * 2.1;
    vec2 at = vec2(cos(a), sin(a * 1.3)) * e * 1.05;
    vec2 d = p - at;
    c += pal(fk) * exp(-dot(d, d) * 4.0) * (0.6 + 0.4 * sin(t * 3.0 + fk * 2.0));
  }
  return light(c * AMOUNT);
}`,
  },
  // the fine lines and a slow rolling band of an old screen: a layer over everything
  scanlines: {
    keys: ['speed', 'amount', 'scale'],
    colors: ['#000000'],
    amount: 0.25,
    quality: 1,
    fallback: 'none',
    body: `vec4 fx() {
  float y = gl_FragCoord.y / (3.0 * SCALE);
  float line = 0.5 + 0.5 * sin(y * 3.14159);
  float roll = exp(-pow((fract(uv.y - time * 0.12 * SPEED) - 0.5) * 7.0, 2.0));
  float dark = (line * 0.8 + 0.2) * AMOUNT * (1.0 - 0.6 * roll);
  return vec4(0.0, 0.0, 0.0, dark);
}`,
  },
  // film grain, a new pattern every 1/24 s: a layer over everything
  grain: {
    keys: ['speed', 'amount'],
    colors: ['#808080'],
    amount: 0.07,
    quality: 1,
    fallback: 'none',
    body: `vec4 fx() {
  int f = int(floor(time * 24.0 * SPEED));
  float n = hash(ivec2(gl_FragCoord.xy) + ivec2(f * 131, f * 71));
  return vec4(vec3(n) * AMOUNT, AMOUNT);
}`,
  },
};

// ------------------------------------------------------------------ parsing

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const BOX = /^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*@\s*(-?\d+(?:\.\d+)?)%\s*,?\s*(-?\d+(?:\.\d+)?)%)?$/;
const PCT = /^(-?\d+(?:\.\d+)?)%$/;
/** Values every preset takes, whatever its own keys. */
const SHARED = ['quality', 'region'];
const KEYS = ['colors', 'background', 'speed', 'amount', 'box', 'radius', 'every', 'angle', 'scale', 'direction', 'at', ...SHARED];

/** `n` percentages separated by spaces (`50% 30%`), as fractions of 1; null when they don't read. */
function percents(v: string | undefined, n: number): number[] | null {
  const parts = (v ?? '').trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length !== n) return null;
  const out = parts.map((x) => PCT.exec(x)).map((m) => (m ? +m[1] / 100 : NaN));
  return out.every(Number.isFinite) ? out : null;
}

/** The values a preset reads, its own then the shared ones (`quality`, `region`); null for a preset that does not exist. */
export function fxKeys(preset: string): string[] | null {
  return (FX_PRESETS as readonly string[]).includes(preset) ? [...PRESETS[preset as FxPreset].keys, ...SHARED] : null;
}

/** `data-fx`'s parts: the preset name and its `key: value` pairs, as written. */
export function splitFx(value: string): { preset: string; values: Record<string, string> } {
  const [head, ...rest] = value.split(';');
  const values: Record<string, string> = {};
  for (const part of rest) {
    const i = part.indexOf(':');
    if (i < 0) {
      if (part.trim()) values[part.trim()] = '';
      continue;
    }
    values[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return { preset: head.trim().toLowerCase(), values };
}

function seconds(v: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s)?$/.exec(v.trim());
  if (!m) return NaN;
  return m[2] === 'ms' ? +m[1] / 1000 : +m[1];
}

/**
 * What is wrong with a `data-fx` value, one message per problem (empty when
 * nothing is). Unknown names and values that do not read are errors, since
 * the effect would quietly fall back to its default.
 */
export function fxIssues(value: string): string[] {
  const { preset, values } = splitFx(value);
  if (!(FX_PRESETS as readonly string[]).includes(preset)) return [`data-fx="${preset}" is not an effect; use ${FX_PRESETS.join(', ')}.`];
  const spec = PRESETS[preset as FxPreset];
  const out: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    if (!KEYS.includes(k)) {
      out.push(`data-fx: "${k}" is not a value of ${preset}; it takes ${[...spec.keys, ...SHARED].join(', ')}.`);
      continue;
    }
    if (!SHARED.includes(k) && !spec.keys.includes(k)) {
      out.push(`data-fx: ${preset} does not use "${k}"; it takes ${[...spec.keys, ...SHARED].join(', ')}.`);
      continue;
    }
    const bad = (what: string) => out.push(`data-fx: ${k}: "${v}" is not ${what}.`);
    if (k === 'colors') {
      const cs = v.split(/[\s,]+/).filter(Boolean);
      if (!cs.length || cs.length > 4 || cs.some((c) => !HEX.test(c))) bad('1 to 4 hex colours (#3d7bff #9861ff)');
    } else if (k === 'background') {
      if (!HEX.test(v)) bad('a hex colour (#07080f)');
    } else if (k === 'box') {
      if (!BOX.test(v)) bad('a size in px with an optional centre in % (760x460 @50% 42%)');
    } else if (k === 'every') {
      if (!(seconds(v) > 0)) bad('a time (3s)');
    } else if (k === 'quality') {
      if (!(+v > 0 && +v <= 2)) bad('a share of the pixels from 0.1 to 2 (0.5)');
    } else if (k === 'speed' || k === 'scale') {
      if (!(+v > 0)) bad('a positive number (1)');
    } else if (k === 'at') {
      if (!percents(v, 2)) bad('a point in % of the frame (50% 30%)');
    } else if (k === 'region') {
      const r = percents(v, 4);
      if (!r || r[2] <= 0 || r[3] <= 0) bad('left, top, width and height in % of the frame (0% 50% 100% 50%)');
    } else if (k === 'amount' || k === 'radius' || k === 'angle' || k === 'direction') {
      if (v === '' || !Number.isFinite(+v) || (k !== 'angle' && k !== 'direction' && +v < 0)) bad('a number');
    }
  }
  return out;
}

/** A `data-fx` value read with every default filled in; null for a preset that does not exist. */
export function parseFx(value: string): FxSpec | null {
  const { preset, values } = splitFx(value);
  if (!(FX_PRESETS as readonly string[]).includes(preset)) return null;
  const p = PRESETS[preset as FxPreset];
  const num = (k: string, d: number, ok: (n: number) => boolean = Number.isFinite) => {
    const n = values[k] === undefined || values[k] === '' ? NaN : +values[k];
    return ok(n) ? n : d;
  };
  const colors = (values.colors ?? '').split(/[\s,]+/).filter((c) => HEX.test(c)).slice(0, 4);
  const bm = BOX.exec(values.box ?? '');
  const every = seconds(values.every ?? '');
  return {
    preset: preset as FxPreset,
    colors: colors.length ? colors : p.colors,
    background: values.background && HEX.test(values.background) ? values.background : (p.background ?? '#000000'),
    speed: num('speed', 1, (n) => n > 0),
    amount: num('amount', p.amount, (n) => n >= 0),
    quality: num('quality', p.quality, (n) => n > 0 && n <= 2),
    box: bm ? { w: +bm[1], h: +bm[2], cx: bm[3] !== undefined ? +bm[3] : 50, cy: bm[4] !== undefined ? +bm[4] : 50 } : { w: 760, h: 460, cx: 50, cy: 50 },
    radius: num('radius', 36, (n) => n >= 0),
    every: every > 0 ? every : 3,
    angle: num('angle', 20),
    scale: num('scale', 1, (n) => n > 0),
    direction: num('direction', p.direction ?? 0),
    center: (percents(values.at, 2) ?? [0.5, 0.5]).map((x) => x * 100) as [number, number],
    region: ((r) => (r && r[2] > 0 && r[3] > 0 ? r : [0, 0, 1, 1]))(percents(values.region, 4)).map((x) => x * 100) as [number, number, number, number],
    fallback: p.fallback,
  };
}

function rgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(+n.toFixed(5)));
const vec3 = (hex: string) => `vec3(${rgb(hex).map(f).join(', ')})`;

/** The fragment shader of an effect: its values as constants, then the preset. */
export function fxShader(spec: FxSpec): string {
  const cols = [0, 1, 2, 3].map((i) => vec3(spec.colors[i % spec.colors.length]));
  return (
    HEADER +
    `const int NC = ${spec.colors.length};\n` +
    `const vec3 COL[4] = vec3[4](${cols.join(', ')});\n` +
    `const vec3 BG = ${vec3(spec.background)};\n` +
    `const float SPEED = ${f(spec.speed)};\nconst float AMOUNT = ${f(spec.amount)};\n` +
    `const vec2 BOX_C = vec2(${f(spec.box.cx / 100)}, ${f(spec.box.cy / 100)});\nconst vec2 BOX_H = vec2(${f(spec.box.w / 2)}, ${f(spec.box.h / 2)});\nconst float BOX_R = ${f(spec.radius)};\n` +
    `const float EVERY = ${f(spec.every)};\nconst float ANGLE = ${f(spec.angle)};\nconst float SCALE = ${f(spec.scale)};\n` +
    `const vec2 DIR = vec2(${f(+Math.cos((spec.direction * Math.PI) / 180).toFixed(5))}, ${f(+Math.sin((spec.direction * Math.PI) / 180).toFixed(5))});\n` +
    `const vec2 AT = vec2(${f(spec.center[0] / 100)}, ${f(spec.center[1] / 100)});\n` +
    `const vec4 REGION = vec4(${spec.region.map((x) => f(x / 100)).join(', ')});\n` +
    LIB +
    PRESETS[spec.preset].body +
    MAIN
  );
}

// ------------------------------------------------------------------ runtime

/**
 * The runtime inside the embed's page. `window.seek(ms)` sizes the canvas
 * (device pixels × quality), draws once and resolves two animation frames
 * later. When WebGL2 or the shader fails it draws the CSS stand-in and posts
 * `effect-error`, so the editor can say why. `live` runs its own clock (a
 * slide being presented); otherwise it stands at `at` until it is sought.
 *
 * A page keeps only 16 WebGL contexts alive and drops the oldest past that, so
 * a long piece with an effect in every scene lost them all. The context is
 * made on the first draw and given back once the embed has not been sought for
 * a while (its scene is off screen), or while a live one is hidden.
 */
const RUNTIME = `(function (cfg) {
  var cv = document.querySelector('canvas'), q = cfg.quality, g = null, ut, ua, us, last = cfg.at || 0, fb = null, idle = 0;
  // give the context back: a still copy of the last frame stays on screen, a fresh canvas waits for the next draw
  var still = null;
  function release() {
    if (!g || !cv.isConnected) return;
    still = cv.cloneNode(false); still.width = cv.width; still.height = cv.height;
    var c2 = still.getContext('2d'); if (c2) c2.drawImage(cv, 0, 0);
    var x = g.getExtension('WEBGL_lose_context'), n = cv.cloneNode(false);
    g = null; if (x) x.loseContext();
    cv.replaceWith(still); cv = n; watch();
  }
  function fail(code, detail) {
    g = null; console.error('[fx] ' + code + (detail ? ': ' + detail : ''));
    parent.postMessage({ dcMotion: 'effect-error', code: code, detail: detail || '', fallback: true }, '*');
    fallback();
  }
  // without WebGL2 the preset draws a CSS version of itself, still a function of time
  function fallback() {
    if (fb) return;
    cv.style.display = 'none';
    fb = document.createElement('div');
    var rg = cfg.region;
    fb.style.cssText = 'position:absolute;inset:0;pointer-events:none;clip-path:inset(' + rg[1] + '% ' + (100 - rg[0] - rg[2]) + '% ' + (100 - rg[1] - rg[3]) + '% ' + rg[0] + '%)';
    document.body.appendChild(fb);
    paint(last);
  }
  function rgba(hex, a) { var h = hex.slice(1); if (h.length === 3) h = h.replace(/./g, function (c) { return c + c; }); return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'; }
  function paint(ms) {
    var t = ms / 1000 * cfg.speed, c = cfg.colors, k = cfg.fallback, s = fb.style, i, l = [];
    if (k === 'aurora' || k === 'field' || k === 'leak') {
      var a = (k === 'aurora' ? 0.45 : k === 'leak' ? 0.5 : 0.9) * cfg.amount, n = Math.min(4, c.length + 1), m = k !== 'aurora';
      for (i = 0; i < n; i++) {
        var x = 50 + 38 * Math.sin(t * (m ? 0.12 : 0.06) * (1 + 0.37 * i) + i * 1.9), y = m ? 50 + 38 * Math.cos(t * 0.1 * (0.8 + 0.29 * i) + i * 2.7) : 22 + 12 * i;
        l.push('radial-gradient(' + (m ? '60% 60%' : '70% 22%') + ' at ' + x.toFixed(2) + '% ' + y.toFixed(2) + '%, ' + rgba(c[i % c.length], Math.min(1, a)) + ', transparent)');
      }
      s.background = l.join(',') + (k === 'leak' ? '' : ',' + cfg.background);
    } else if (k === 'edge') {
      var b = cfg.box;
      s.inset = 'auto'; s.left = 'calc(' + b.cx + '% - ' + b.w / 2 + 'px)'; s.top = 'calc(' + b.cy + '% - ' + b.h / 2 + 'px)';
      s.width = b.w + 'px'; s.height = b.h + 'px'; s.borderRadius = cfg.radius + 'px';
      var ph = Math.floor((t * 0.24 % 1) * c.length) % c.length;
      s.boxShadow = '0 0 0 2px ' + rgba(c[ph], cfg.amount) + ', 0 0 36px 4px ' + rgba(c[(ph + 1) % c.length], 0.5 * cfg.amount) + ', 0 0 140px 24px ' + rgba(c[(ph + 2) % c.length], 0.18 * cfg.amount);
    } else if (k === 'sweep') {
      var p = (t / cfg.every) % 1, at = -40 + 180 * Math.min(1, p / 0.6);
      s.background = 'linear-gradient(' + (cfg.angle + 90) + 'deg, transparent ' + (at - 8) + '%, ' + rgba(c[0], cfg.amount) + ' ' + at + '%, transparent ' + (at + 8) + '%)';
    }
  }
  function compile(type, src) { var x = g.createShader(type); g.shaderSource(x, src); g.compileShader(x); if (!g.getShaderParameter(x, g.COMPILE_STATUS)) throw { code: 'shader', detail: g.getShaderInfoLog(x) }; return x; }
  function init() {
    if (still) { still.replaceWith(cv); still = null; }
    g = cv.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!g) return fail('no-webgl2');
    try {
      // a GPU without highp in fragment shaders takes mediump
      var hp = g.getShaderPrecisionFormat(g.FRAGMENT_SHADER, g.HIGH_FLOAT), fs = hp && hp.precision ? cfg.frag : cfg.frag.replace('precision highp float', 'precision mediump float');
      var pr = g.createProgram();
      g.attachShader(pr, compile(g.VERTEX_SHADER, '#version 300 es\\nout vec2 v_uv;\\nvoid main(){vec2 p=vec2(gl_VertexID==1?3.:-1.,gl_VertexID==2?3.:-1.);v_uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}'));
      g.attachShader(pr, compile(g.FRAGMENT_SHADER, fs));
      g.linkProgram(pr);
      if (!g.getProgramParameter(pr, g.LINK_STATUS)) throw { code: 'shader', detail: g.getProgramInfoLog(pr) };
      // an attribute-less triangle needs a bound vertex array on some ANGLE backends
      g.useProgram(pr); g.bindVertexArray(g.createVertexArray());
      ut = g.getUniformLocation(pr, 'time'); ua = g.getUniformLocation(pr, 'u_aspect'); us = g.getUniformLocation(pr, 'u_size');
    } catch (e) { fail(e.code || 'shader', e.detail || String(e)); }
  }
  // a lost context (the GPU reset, too many canvases) comes back empty: build it again and draw the last time
  function watch() {
    cv.addEventListener('webglcontextlost', function (e) { e.preventDefault(); g = null; });
    cv.addEventListener('webglcontextrestored', function () { init(); window.seek(last); });
  }
  watch();
  window.seek = function (ms) {
    last = ms;
    var fresh = !g && !fb;
    if (fb) paint(ms);
    else {
      if (fresh) init();
      if (g) draw(ms);
    }
    if (!cfg.live) { clearTimeout(idle); idle = setTimeout(release, 1500); }
    // a canvas presents a frame late, a new one later still: wait until this one is on screen
    return new Promise(function (r) { var n = fresh ? 4 : 2; (function f() { if (--n < 0) r(); else requestAnimationFrame(f); })(); });
  };
  function draw(ms) {
      var r = devicePixelRatio || 1, w = Math.max(1, Math.round(innerWidth * r * q)), h = Math.max(1, Math.round(innerHeight * r * q));
      try {
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
        g.viewport(0, 0, w, h); g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
        g.uniform1f(ut, ms / 1000); g.uniform1f(ua, w / h); g.uniform2f(us, innerWidth, innerHeight); g.drawArrays(g.TRIANGLES, 0, 3);
      } catch (e) { fail('draw', String(e)); }
  }
  addEventListener('resize', function () { if (g || fb) window.seek(last); });
  // a live one (a slide being presented) draws only while it can be seen: a hidden slide's frame is 0 wide
  if (cfg.live) { var t0 = performance.now() - last; (function tick() { if (innerWidth > 0) window.seek(performance.now() - t0); else release(); requestAnimationFrame(tick); })(); }
  // otherwise nothing is drawn until the embed is sought: a piece mounts every scene's embeds at once, and a
  // context made for each at load would pass the page's limit before the first frame
})`;

/**
 * The markup of a `data-fx` embed's page; null when the value names no preset.
 * `live` runs the effect on its own clock; `at` is the time (ms) it stands at
 * until it is sought.
 */
export function fxMarkup(value: string, o: { live?: boolean; at?: number } = {}): string | null {
  const spec = parseFx(value);
  if (!spec) return null;
  const cfg = { ...spec, frag: fxShader(spec), live: !!o.live, at: o.at ?? 0 };
  // every `<` written as an escape, so nothing in the values can close the script
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c');
  return `<style>html,body{height:100%}</style><canvas style="display:block;width:100%;height:100%"></canvas><script>${RUNTIME}(${json});</script>`;
}

/** Does this embed draw a built-in effect: `data-fx` and no markup of its own. */
export function isFxEmbed(attrs: { 'data-fx'?: string }, inner: string): boolean {
  return attrs['data-fx'] !== undefined && !inner.trim();
}

/** The moment (ms) a built-in effect stands at where nothing seeks it (a slide being edited): far enough in for its light to have moved. */
export const FX_STILL_MS = 2000;
