import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KIND_SKILL, type SkillInfo, type SkillScope } from '@dc/core';
import { setSkillChoice, useStore } from '../store';
import { Dialog } from './Dialog';
import { SkillI } from './icons';

/**
 * The skills a chat can use (.design/chat-skills.md): the format references and the person's own
 * skills this machine has, picked where the request is written. A change is saved at once; every
 * Claude Code request in the project then reads the chosen skills before it starts.
 */

/** The order the scopes are read in: what belongs to this work first, what belongs to the person last. */
const GROUPS: SkillScope[] = ['project', 'builtin', 'user'];
const HEADING = {
  project: 'prompt.skills.fromProject',
  builtin: 'prompt.skills.builtIn',
  user: 'prompt.skills.yours',
} as const satisfies Record<SkillScope, string>;

/** The kinds' own format references are read with every request: they show as chosen and cannot be turned off. */
function isAlways(s: SkillInfo, kind: string | null): boolean {
  return !!kind && KIND_SKILL[kind as keyof typeof KIND_SKILL] === s.id;
}

export function SkillsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const kind = useStore((s) => s.kind);
  const skills = useStore((s) => s.skills);
  const chosen = useStore((s) => s.skillChoice);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const matches = (s: SkillInfo) => !query || [s.id, s.name, s.description].some((v) => v.toLowerCase().includes(query));
  const on = new Set(chosen);
  const pick = (s: SkillInfo) => setSkillChoice(on.has(s.id) ? chosen.filter((id) => id !== s.id) : [...chosen, s.id]);
  const groups = GROUPS.map((scope) => ({ scope, list: skills.filter((s) => s.scope === scope && matches(s)) })).filter((g) => g.list.length);
  return (
    <Dialog label={t('prompt.skills.title')} className="refsdlg skillsdlg" onClose={onClose}>
      <p className="kblurb">{t('prompt.skills.blurb')}</p>
      {skills.length ? (
        <input className="inp skills-search" type="search" value={q} placeholder={t('prompt.skills.search')} aria-label={t('prompt.skills.search')} autoFocus onChange={(e) => setQ(e.currentTarget.value)} />
      ) : null}
      {!skills.length ? (
        <p className="refnote">{t('prompt.skills.none')}</p>
      ) : !groups.length ? (
        <p className="refnote">{t('prompt.skills.noMatch', { query: q.trim() })}</p>
      ) : (
        groups.map(({ scope, list }) => (
          <section key={scope} aria-label={t(HEADING[scope])}>
            <h3>{t(HEADING[scope])}</h3>
            <ul>
              {list.map((s) => {
                const always = isAlways(s, kind);
                const checked = always || on.has(s.id);
                return (
                  <li key={s.id}>
                    <label className={`refrow skillrow${checked ? ' on' : ''}`} title={s.description ? `${s.description}\n${s.path}` : s.path}>
                      <input type="checkbox" checked={checked} disabled={always} onChange={() => pick(s)} aria-label={t('prompt.skills.pick', { name: s.name })} />
                      <SkillI />
                      <span className="rname">{s.name}</span>
                      <span className="rpath">{always ? t('prompt.skills.always') : s.description}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      <footer>
        <button type="button" className="btn primary" onClick={onClose}>
          {t('common.done')}
        </button>
      </footer>
    </Dialog>
  );
}

/** The request bar's way in: what this chat reads, beside the request's other options. */
export function SkillsChip() {
  const { t } = useTranslation();
  const count = useStore((s) => s.skillChoice.length);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`ctx-chip action skillchip${count ? ' on' : ''}`} title={t('prompt.skills.hint')} onClick={() => setOpen(true)}>
        <SkillI /> {count ? t('prompt.skills.chipCount', { count }) : t('prompt.skills.chip')}
      </button>
      {open && <SkillsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** What a run read, on its card and in the conversation: a read-only row of the skills it was given. */
export function SkillChips({ ids }: { ids: string[] }) {
  const { t } = useTranslation();
  const all = useStore((s) => s.skills);
  if (!ids.length) return null;
  const nameOf = (id: string) => all.find((s) => s.id === id);
  return (
    <div className="run-skills">
      <span>{t('prompt.skills.run')}</span>
      {ids.map((id) => {
        const s = nameOf(id);
        return (
          <code key={id} className="skill-chip" title={s?.description || s?.path || id}>
            <SkillI /> {s?.name ?? id}
          </code>
        );
      })}
    </div>
  );
}