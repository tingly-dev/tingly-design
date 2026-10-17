import { goTo } from '../../host';

const RECENT_KEY = 'dc:recent-projects';

export function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function open(name: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([name, ...readRecent().filter((n) => n !== name)].slice(0, 20)));
  } catch {
    // private mode: nothing to remember
  }
  goTo(name);
}
