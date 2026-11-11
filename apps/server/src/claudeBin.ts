import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { aiResolved } from './aiconfig';

/**
 * Where the `claude` command is: the person's own setting when there is one, else `claude` on the server's PATH.
 * Nothing else is searched: a server started without the shell's PATH (a desktop app, a service) says so and
 * the settings take the path by hand (.design/ai-settings.md).
 */

export interface ClaudeCommand {
  /** what to run; null when nothing answered */
  path: string | null;
  /** its `--version`, when it answered */
  version?: string;
}

const home = (p: string) => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);

/** Whether this command runs and says its version. */
function answers(cmd: string): string | null {
  try {
    const r = spawnSync(cmd, ['--version'], { timeout: 5000, encoding: 'utf8' });
    return r.status === 0 ? (r.stdout.trim().split('\n')[0] ?? '') : null;
  } catch {
    return null;
  }
}

/** What answers for this setting (a path or a name; empty means `claude` on the PATH). */
export function findClaude(configured: string): ClaudeCommand {
  const set = home(configured.trim());
  if (set) {
    const version = answers(set);
    // no fallback: a path the person typed is not silently replaced by another
    return version === null ? { path: null } : { path: set, version };
  }
  const onPath = answers('claude');
  return onPath !== null ? { path: 'claude', version: onPath } : { path: null };
}

let last: { configured: string; at: number; found: ClaudeCommand } | null = null;
/** A command that answered stays for as long as the setting is the same; one that did not is asked again after a few seconds, so installing it needs no restart. */
const RETRY_MS = 5000;

/** The command for the saved (or the host's) setting. */
export function claudeCommand(): ClaudeCommand {
  const configured = aiResolved().claude.command.value;
  if (last && last.configured === configured && (last.found.path || Date.now() - last.at < RETRY_MS)) return last.found;
  last = { configured, at: Date.now(), found: findClaude(configured) };
  return last.found;
}
