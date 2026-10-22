import { claudeAvailable } from '../delegate';

let cliChecked: boolean | null = null;
/** Whether the Claude Code command is on this machine. Asked once. */
export function claudeCliReady(): boolean {
  cliChecked ??= claudeAvailable();
  return cliChecked;
}
