import { describe, expect, it } from 'vitest';
import { compactTranscript, isTurn, parseTranscript, trimTurn, TRANSCRIPT_LIMITS, type Turn } from '../src';

const turn = (id: string, extra: Partial<Turn> = {}): Turn => ({ id, agent: 'claude', prompt: `ask ${id}`, source: 'editor', state: 'done', startedAt: 1, steps: [], files: [], ...extra });
const lines = (...t: Turn[]) => t.map((x) => JSON.stringify(x)).join('\n') + '\n';

describe('parseTranscript', () => {
  it('keeps the last line of a turn in the place of its first', () => {
    const got = parseTranscript(lines(turn('a', { state: 'running' }), turn('b'), turn('a', { answer: 'done it' })));
    expect(got.map((t) => t.id)).toEqual(['a', 'b']);
    expect(got[0].answer).toBe('done it');
  });
  it('skips damaged and foreign lines', () => {
    const got = parseTranscript(`{"id":"x"}\nnot json\n${JSON.stringify(turn('ok'))}\n{`);
    expect(got.map((t) => t.id)).toEqual(['ok']);
  });
  it('returns the newest `limit` turns', () => {
    const got = parseTranscript(lines(turn('1'), turn('2'), turn('3')), 2);
    expect(got.map((t) => t.id)).toEqual(['2', '3']);
  });
});

describe('isTurn', () => {
  it('needs the fields the panel draws', () => {
    expect(isTurn(turn('a'))).toBe(true);
    expect(isTurn({ ...turn('a'), source: 'web' })).toBe(false);
    expect(isTurn({ ...turn('a'), steps: undefined })).toBe(false);
    expect(isTurn(null)).toBe(false);
  });
});

describe('trimTurn', () => {
  it('cuts long text', () => {
    const t = trimTurn(turn('a', { prompt: 'x'.repeat(10_000), answer: 'y'.repeat(10_000) }));
    expect(t.prompt).toHaveLength(TRANSCRIPT_LIMITS.text);
    expect(t.answer).toHaveLength(TRANSCRIPT_LIMITS.text);
  });
  it('folds the middle of a long run into a count', () => {
    const steps = Array.from({ length: 1000 }, (_, i) => ({ say: `s${i}`, at: i }));
    const t = trimTurn(turn('a', { steps }));
    expect(t.steps).toHaveLength(TRANSCRIPT_LIMITS.steps);
    const gap = t.steps.find((e) => 'omitted' in e) as { omitted: number };
    expect(gap.omitted).toBe(1000 - (TRANSCRIPT_LIMITS.steps - 1));
    expect(t.steps[0]).toEqual({ say: 's0', at: 0 });
    expect(t.steps.at(-1)).toEqual({ say: 's999', at: 999 });
  });
  it('leaves a short turn alone', () => expect(trimTurn(turn('a'))).toEqual(turn('a')));
});

describe('compactTranscript', () => {
  it('writes one line per turn, the newest turns only', () => {
    const many = Array.from({ length: TRANSCRIPT_LIMITS.turns + 5 }, (_, i) => turn(String(i)));
    const text = compactTranscript(many);
    expect(text.trimEnd().split('\n')).toHaveLength(TRANSCRIPT_LIMITS.turns);
    expect(parseTranscript(text)[0].id).toBe('5');
  });
});
