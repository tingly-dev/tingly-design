import { describe, expect, it } from 'vitest';
import { runNewWizard, slugOf, WIZARD_KINDS, type WizardComplaint, type WizardIO } from '../src';

/** Answers in order; records what was asked and what was complained about. */
function script(answers: string[]) {
  const asked: string[] = [];
  const complaints: WizardComplaint[] = [];
  const options: Record<string, string[]> = {};
  const next = (id: string) => {
    asked.push(id);
    if (!answers.length) throw new Error(`no answer left for ${id}`);
    return Promise.resolve(answers.shift()!);
  };
  const io: WizardIO = {
    select: (id, opts) => ((options[id] = opts.map((o) => o.value)), next(id)),
    text: (id) => next(id),
    complain: (why) => void complaints.push(why),
  };
  return { io, asked, complaints, options };
}

describe('runNewWizard', () => {
  it('offers all six kinds and defaults to a canvas, whose first size is the dialog’s', async () => {
    const s = script(['', 'Landing', '', '', '']);
    const a = await runNewWizard(s.io, {}, new Set());
    expect(s.options.kind).toEqual([...WIZARD_KINDS]);
    expect(WIZARD_KINDS).toHaveLength(6);
    expect(s.asked).toEqual(['kind', 'title', 'name', 'group', 'size']);
    expect(a).toEqual({ kind: 'canvas', title: 'Landing', target: 'landing', size: [1200, 760] });
  });

  it('picks a canvas size in two steps, by number or by name', async () => {
    const s = script(['1', 'Cover', 'cover', 'wechat', 'wechat']);
    expect((await runNewWizard(s.io, {}, new Set())).size).toEqual([900, 383]);
    expect(s.options.size).toContain('wxchannelh');
    expect(s.options.size).not.toContain('a4');
    const n = script(['canvas', 'Cover', '', '4', 'portrait']);
    expect((await runNewWizard(n.io, {}, new Set())).size).toEqual([1080, 1350]);
  });

  it('takes a custom canvas or motion size, and asks again for a bad one', async () => {
    const s = script(['canvas', 'X', '', 'custom', '5000x0', '1080×1440']);
    expect((await runNewWizard(s.io, {}, new Set())).size).toEqual([1080, 1440]);
    expect(s.complaints).toEqual(['badSize']);
    const m = script(['motion', 'Intro', '', 'social', 'story']);
    expect(await runNewWizard(m.io, {}, new Set())).toEqual({ kind: 'motion', title: 'Intro', target: 'intro', size: [1080, 1920] });
    const d = script(['motion', 'Intro', '', 'custom', '800x800']);
    expect((await runNewWizard(d.io, {}, new Set())).size).toEqual([800, 800]);
  });

  it('asks a deck for its size like a canvas and a motion piece', async () => {
    const s = script(['slides', 'Talk', '', 'slides', 'standard']);
    expect((await runNewWizard(s.io, {}, new Set())).size).toEqual([1600, 1200]);
  });

  it('asks nothing about size for the other kinds', async () => {
    for (const kind of ['design-system', 'dashboard', 'doc']) {
      const s = script([kind, 'Thing', '']);
      const a = await runNewWizard(s.io, {}, new Set());
      expect(s.asked).toEqual(['kind', 'title', 'name']);
      expect(a.size).toBeUndefined();
    }
  });

  it('skips what is given', async () => {
    const s = script(['screen', 'mobile']);
    expect(await runNewWizard(s.io, { kind: 'canvas', title: 'App', target: 'app' }, new Set())).toEqual({ kind: 'canvas', title: 'App', target: 'app', size: [390, 844] });
    expect(s.asked).toEqual(['group', 'size']);
    const g = script([]);
    expect(await runNewWizard(g.io, { kind: 'canvas', title: 'T', target: 't', size: [800, 600] }, new Set())).toEqual({ kind: 'canvas', title: 'T', target: 't', size: [800, 600] });
  });

  it('suggests a free folder name, refuses a bad or taken one, and lets a path through', async () => {
    const taken = new Set(['pitch']);
    expect((await runNewWizard(script(['doc', 'Pitch', '']).io, {}, taken)).target).toBe('pitch-2');
    const b = script(['doc', 'Pitch', 'pitch', 'bad name!', '~/work/pitch']);
    const a = await runNewWizard(b.io, {}, taken);
    expect(b.complaints).toEqual(['taken', 'badName']);
    expect(a.target).toBe('~/work/pitch');
  });

  it('asks again for an empty title and an unknown choice', async () => {
    const s = script(['99', 'doc', '  ', 'Notes', '']);
    const a = await runNewWizard(s.io, {}, new Set());
    expect(s.complaints).toEqual(['badChoice', 'empty']);
    expect(a).toEqual({ kind: 'doc', title: 'Notes', target: 'notes' });
  });

  it('falls back to the kind for a title with no folder-name letters', async () => {
    expect((await runNewWizard(script(['doc', '周报', '']).io, {}, new Set())).target).toBe('doc');
    expect(slugOf('周报')).toBe('');
  });
});
