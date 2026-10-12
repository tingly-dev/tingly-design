import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where everything the server needs lives, for both ways it runs:
 *
 * - from the repository (`pnpm dev`, `pnpm start`): this file is
 *   apps/server/src/layout.ts and the editor, sandbox and samples sit in
 *   their workspace folders;
 * - from the bundle a host ships (`pnpm bundle`, see docs/en/embedding.md):
 *   server.mjs sits next to tingly-design.json, editor/, sandbox/, samples/,
 *   scripts/ and .claude/skills/.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** The bundle's manifest: its presence is what tells the two layouts apart. */
export const MANIFEST = 'tingly-design.json';
export const BUNDLED = existsSync(join(here, MANIFEST));

/** The repository root, or the bundle folder. Claude Code runs here, so it finds .claude/skills and scripts/. */
export const ROOT = resolve(process.env.DC_ROOT ?? (BUNDLED ? here : join(here, '../../..')));
export const EDITOR_DIST = join(ROOT, BUNDLED ? 'editor' : 'apps/editor/dist');
export const SANDBOX_DIST = join(ROOT, BUNDLED ? 'sandbox' : 'packages/sandbox/dist');
/** The sample projects copied into a projects folder that does not exist yet. */
export const SAMPLES_DIR = join(ROOT, BUNDLED ? 'samples' : 'projects');
export const PROJECTS_DIR = resolve(process.env.DC_PROJECTS ?? join(ROOT, 'projects'));

/** A path to show or hand to Claude Code: relative to ROOT when inside it, absolute otherwise. */
export function fromRoot(abs: string): string {
  const rel = relative(ROOT, abs);
  if (rel === '') return '.';
  return rel.startsWith('..') || isAbsolute(rel) ? abs : rel;
}
/** False when a host keeps the projects elsewhere: Claude Code then needs --add-dir for them. */
export const PROJECTS_INSIDE_ROOT = fromRoot(PROJECTS_DIR) !== PROJECTS_DIR;

/**
 * DC_BASE_PATH: the path prefix the server answers under, for a host that
 * mounts it at, say, /design without stripping the prefix. '' at the root.
 */
export const BASE_PATH = (() => {
  const v = (process.env.DC_BASE_PATH ?? '').trim().replace(/\/+$/, '');
  if (!v) return '';
  if (!/^(\/[A-Za-z0-9._~-]+)+$/.test(v)) throw new Error(`DC_BASE_PATH must look like /design, got ${JSON.stringify(process.env.DC_BASE_PATH)}`);
  return v;
})();

/** The version a host sees in /api/health and the ready line. */
export const VERSION: string = (() => {
  for (const f of [join(ROOT, MANIFEST), join(ROOT, 'package.json')]) {
    try {
      const v = JSON.parse(readFileSync(f, 'utf8')).version;
      if (typeof v === 'string') return v;
    } catch {
      // try the next one
    }
  }
  return '0.0.0';
})();

/**
 * The host contract's version: bumped when the launch environment, the
 * ready line, /api/health or the postMessage protocol change incompatibly.
 */
export const PROTOCOL = 1;
