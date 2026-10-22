/**
 * Structured server log: one line per event, `time level event key=value …`,
 * on stderr (stdout carries the READY line a host parses).
 *
 * DC_LOG_LEVEL: error | warn | info (default) | debug, or `silent`.
 * DC_LOG_FORMAT=json prints each line as a JSON object instead.
 * info records what happened (a fast-AI call, a Claude Code run, its outcome);
 * debug adds each tool step and the stream's size. Prompts and replies are
 * never logged, only their length.
 */

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 } as const;
export type LogLevel = Exclude<keyof typeof LEVELS, 'silent'>;

function levelFromEnv(): keyof typeof LEVELS {
  const v = process.env.DC_LOG_LEVEL?.trim().toLowerCase();
  return v && v in LEVELS ? (v as keyof typeof LEVELS) : 'info';
}

let threshold: number = LEVELS[levelFromEnv()];
const json = process.env.DC_LOG_FORMAT?.trim().toLowerCase() === 'json';

function fmt(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return /^[\w./:@-]+$/.test(s) ? s : JSON.stringify(s);
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] > threshold) return;
  const at = new Date().toISOString();
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const line = json
    ? JSON.stringify({ at, level, event, ...clean })
    : `${at} ${level.toUpperCase().padEnd(5)} ${event}${Object.entries(clean)
        .map(([k, v]) => ` ${k}=${fmt(v)}`)
        .join('')}`;
  process.stderr.write(line + '\n');
}

export const logError = (event: string, f?: Record<string, unknown>) => log('error', event, f);
export const logWarn = (event: string, f?: Record<string, unknown>) => log('warn', event, f);
export const logInfo = (event: string, f?: Record<string, unknown>) => log('info', event, f);
export const logDebug = (event: string, f?: Record<string, unknown>) => log('debug', event, f);
