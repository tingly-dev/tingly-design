/**
 * The terminal side of `tingly-design new -i`: the questions of core's `runNewWizard` as numbered lists and prompts,
 * worded in the command's language. Prompts go to stderr, so `--json` keeps stdout for the result.
 */
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { runNewWizard, type WizardGiven, type WizardIO } from '@dc/core';

export class Cancelled extends Error {}

/** Keys here are composed from the choices (a size's id, a kind), which the typed translator cannot follow. */
type T = (key: string, params?: Record<string, string>) => string;

/** `where` is how a taken name's folder is shown: `.` for the current directory, `projects` for the projects folder. */
export function terminalWizard(t: T, input: Readable, output: Writable, where = 'projects') {
  const rl = createInterface({ input, output, terminal: !!(input as { isTTY?: boolean }).isTTY });
  let reject: ((e: Error) => void) | null = null;
  // Ctrl+C and Ctrl+D end the questions
  rl.on('SIGINT', () => rl.close());
  rl.on('close', () => reject?.(new Cancelled(t('cli.cancelled'))));
  const write = (s: string) => output.write(s);
  const line = (prompt: string) =>
    new Promise<string>((resolve, rej) => {
      reject = rej;
      rl.question(prompt, (a) => {
        reject = null;
        resolve(a);
      });
    });

  const label = (id: string, value: string, size?: readonly [number, number]) => {
    const name = id === 'kind' ? t(`launcher.kind.${value === 'canvas' ? 'design' : value === 'doc' ? 'docs' : value}.name`) : id === 'group' ? (value === 'custom' ? t('launcher.new.sizeCustom') : t(`canvas.boardGroup.${value}`)) : value === 'custom' ? t('launcher.new.sizeCustom') : t(`canvas.boardSize.${value}`);
    const dims = size ? ` (${size[0]}×${size[1]})` : '';
    const note = id === 'kind' ? t(`launcher.kind.${value === 'canvas' ? 'design' : value === 'doc' ? 'docs' : value}.blurb`) : id === 'size' ? t(`canvas.boardFor.${value}`) : '';
    return { name, dims, note };
  };

  const io: WizardIO = {
    async select(id, options, initial) {
      write(`\n${t(`cli.wizard.${id}`)}\n`);
      const rows = options.map((o, i) => ({ n: `${i + 1}`, value: o.value, ...label(id, o.value, o.size) }));
      const w = Math.max(...rows.map((r) => (r.name + r.dims).length));
      for (const r of rows) write(`  ${r.n.padStart(2)}) ${(r.name + r.dims).padEnd(w)}${r.note ? `  ${r.note}` : ''}${r.value === initial ? `  ${t('cli.wizard.default')}` : ''}\n`);
      const shown = rows.find((r) => r.value === initial);
      return line(t('cli.wizard.choose', { default: shown ? ` [${shown.n}]` : '' }) + ' ');
    },
    async text(id, initial) {
      return line(t(`cli.wizard.${id}`) + (initial ? ` [${initial}]` : '') + ': ');
    },
    complain(why, params) {
      write(`${t(`cli.wizard.complaint.${why}`, { where, ...params })}\n`);
    },
  };

  return {
    run: (given: WizardGiven, taken: ReadonlySet<string>) => runNewWizard(io, given, taken),
    /** A yes/no (Enter is yes) */
    async confirm(id: 'openNow') {
      const a = (await line(`\n${t(`cli.wizard.${id}`)} [Y/n] `)).trim().toLowerCase();
      return a === '' || a === 'y' || a === 'yes';
    },
    close: () => rl.close(),
  };
}
