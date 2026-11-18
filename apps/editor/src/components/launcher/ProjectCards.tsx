import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { type ProjectCard, type ProjectKind } from '@dc/core';
import { Chevron, FileZip, GroupFolder, More, Plus, Rename, Trash, Unlink } from '../icons';
import { saveProjectArchive } from '../../projectArchive';
import { Menu, MenuItem } from '../Menu';
import { useElementSize } from '../../hooks';
import { Preview } from './Preview';
import { KIND, KindIcon } from './kinds';
import { open } from './recent';

export function ago(t: TFunction, iso: string | null): string {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return t('launcher.ago.now');
  if (s < 3600) return t('launcher.ago.minutes', { count: Math.floor(s / 60) });
  if (s < 86400) return t('launcher.ago.hours', { count: Math.floor(s / 3600) });
  if (s < 86400 * 30) return t('launcher.ago.days', { count: Math.floor(s / 86400) });
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The ⋯ beside a card or row: it sits next to the card, not inside it, since a card is itself a button. */
function MoreButton({ p, onMore }: { p: ProjectCard; onMore: (name: string, at: DOMRect) => void }) {
  const { t } = useTranslation();
  return (
    <button className="lmore" aria-label={t('launcher.rowMenu', { title: p.title || p.name })} data-more={p.name} onClick={(e) => onMore(p.name, e.currentTarget.getBoundingClientRect())}>
      <More />
    </button>
  );
}

/** What a list says of a project's place in the tree: how many sub-projects it has and whether they are showing, how deep it is, and the parent it is listed away from. */
export interface Nest {
  subs: number;
  open: boolean;
  depth: number;
  /** the title of the parent of a sub-project: a card says it, a row does when it is listed away from its parent (another kind's tab, a search) */
  under?: string;
  onToggle: () => void;
}

/** The count of sub-projects beside the ⋯: a click shows them right under their parent. */
function SubsButton({ nest }: { nest: Nest }) {
  const { t } = useTranslation();
  if (!nest.subs) return null;
  return (
    <button className="lsubs" aria-expanded={nest.open} aria-label={t(nest.open ? 'launcher.sub.hide' : 'launcher.sub.show', { count: nest.subs })} title={t(nest.open ? 'launcher.sub.hide' : 'launcher.sub.show', { count: nest.subs })} onClick={nest.onToggle}>
      <Chevron open={nest.open} />
      <span>{nest.subs}</span>
    </button>
  );
}

export function Card({ p, recent, flat, nest, onMore }: { p: ProjectCard; recent: boolean; flat: boolean; nest: Nest; onMore: (name: string, at: DOMRect) => void }) {
  const { t } = useTranslation();
  const [ref, { w: width }] = useElementSize<HTMLButtonElement>();
  const k = KIND[p.kind];
  const kindName = t(`launcher.kind.${p.kind}.name`);
  return (
    <div className={`lcell${nest.depth ? ' lsub' : ''}`} data-depth={nest.depth || undefined}>
      <button ref={ref} className={`lcard t-${k.tone}`} data-project={p.name} data-kind={p.kind} onClick={() => open(p.name)} aria-label={t('launcher.card.open', { title: p.title, kind: kindName })}>
        <Preview p={p.preview} project={p.name} width={width} />
        <div className="lbody">
          <div className="ltitle">
            <span className="name">{p.title || p.name}</span>
            {recent && <span className="recent">{t('launcher.card.recent')}</span>}
          </div>
          <div className="lmeta">
            <span className="kbadge">
              <KindIcon kind={p.kind} size={12} />
              {kindName}
            </span>
            <span>{t(`launcher.kind.${p.kind}.count`, { count: p.count })}</span>
            {p.updatedAt && <span>{ago(t, p.updatedAt)}</span>}
          </div>
          <div className={`lpath${p.path ? ' far' : ''}`} title={p.path}>
            <span className="lfolder">
              <bdi>{p.path ?? `projects/${p.name}`}</bdi>
            </span>
            {flat && p.group && <span className="lgroup">· {p.group}</span>}
          </div>
          {nest.under && <div className="lunder">↳ {t('launcher.sub.in', { parent: nest.under })}</div>}
        </div>
      </button>
      <SubsButton nest={nest} />
      <MoreButton p={p} onMore={onMore} />
    </div>
  );
}

/** One project as a line: no preview, so a long list stays light. */
export function Row({ p, recent, nest, onMore }: { p: ProjectCard; recent: boolean; nest: Nest; onMore: (name: string, at: DOMRect) => void }) {
  const { t } = useTranslation();
  const k = KIND[p.kind];
  const kindName = t(`launcher.kind.${p.kind}.name`);
  return (
    <div className={`lcell lrowcell${nest.depth ? ' lsub' : ''}`} data-depth={nest.depth || undefined}>
      <button className={`lrow t-${k.tone}`} data-project={p.name} data-kind={p.kind} onClick={() => open(p.name)} aria-label={t('launcher.card.open', { title: p.title, kind: kindName })}>
        <span className="c-title">
          <span className="kic" title={kindName}>
            <KindIcon kind={p.kind} size={15} />
          </span>
          <span className="name">{p.title || p.name}</span>
          {nest.under && !nest.depth && <span className="lunder">↳ {t('launcher.sub.in', { parent: nest.under })}</span>}
          {recent && <span className="recent">{t('launcher.card.recent')}</span>}
        </span>
        <span className={`c-path${p.path ? ' far' : ''}`} title={p.path}>
          <bdi>{p.path ?? `projects/${p.name}`}</bdi>
        </span>
        <span className="c-group">{p.group ?? ''}</span>
        <span className="c-size">{t(`launcher.kind.${p.kind}.count`, { count: p.count })}</span>
        <span className="c-when">{p.updatedAt ? ago(t, p.updatedAt) : ''}</span>
      </button>
      <SubsButton nest={nest} />
      <MoreButton p={p} onMore={onMore} />
    </div>
  );
}

/** A small text box inside a menu: rename a title, or name a group. */
function MenuInput({ value, onChange, onEnter, label, placeholder }: { value: string; onChange: (v: string) => void; onEnter: () => void; label: string; placeholder?: string }) {
  return (
    <input
      className="input menu-input"
      autoFocus
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

/** What a project's ⋯ opens: its actions, then the rename box or the group list. */
export function ProjectActions({ p, at, groups, onClose, onRename, onMove, onSub, onUnlink, onDelete }: { p: ProjectCard; at: { x: number; y: number }; groups: string[]; onClose: () => void; onRename: (title: string) => void; onMove: (group: string) => void; onSub?: () => void; onUnlink: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<'menu' | 'rename' | 'group'>('menu');
  const [text, setText] = useState(p.title || p.name);
  const typed = text.trim();
  const matches = step === 'group' ? groups.filter((g) => g.toLowerCase().includes(typed.toLowerCase())) : [];
  const exact = groups.find((g) => g.toLowerCase() === typed.toLowerCase());
  const label = step === 'rename' ? t('launcher.rename.label') : step === 'group' ? t('launcher.group.moveTo') : t('launcher.rowMenu', { title: p.title || p.name });
  return (
    <Menu x={at.x} y={at.y} align="right" onClose={onClose} label={label}>
      {step === 'menu' && (
        <>
          <MenuItem label={t('launcher.rename.menu')} icon={<Rename />} onSelect={() => setStep('rename')} />
          {!p.parent && <MenuItem label={t('launcher.group.moveTo')} icon={<GroupFolder />} onSelect={() => (setText(''), setStep('group'))} />}
          {onSub && <MenuItem label={t('launcher.sub.menu')} icon={<Plus />} onSelect={() => (onSub(), onClose())} />}
          <MenuItem label={t('launcher.archive.export')} icon={<FileZip />} onSelect={() => (onClose(), void saveProjectArchive(p.name, true))} />
          {(!p.path || p.parent) && (
            <>
              <div className="msep" role="separator" />
              <MenuItem label={t('launcher.trash.menu')} icon={<Trash />} danger onSelect={() => (onDelete(), onClose())} />
            </>
          )}
          {p.path && !p.parent && !p.folderGroup && (
            <>
              <div className="msep" role="separator" />
              <MenuItem label={t('launcher.folder.unlink')} icon={<Unlink />} onSelect={() => (onUnlink(), onClose())} />
            </>
          )}
        </>
      )}
      {step === 'rename' && (
        <div className="menu-form">
          <MenuInput label={t('launcher.rename.label')} value={text} onChange={setText} onEnter={() => typed && (onRename(typed), onClose())} />
          <div className="menu-note">{t('launcher.rename.hint')}</div>
        </div>
      )}
      {step === 'group' && (
        <>
          <div className="menu-form">
            <MenuInput
              label={t('launcher.group.pick')}
              placeholder={t('launcher.group.pick')}
              value={text}
              onChange={setText}
              onEnter={() => typed && (onMove(exact ?? typed), onClose())}
            />
          </div>
          {matches.map((g) => (
            <MenuItem key={g} label={g} icon={<GroupFolder />} checked={g === p.group} onSelect={() => (onMove(g), onClose())} />
          ))}
          {typed && !exact && <MenuItem label={t('launcher.group.create', { name: typed })} icon={<GroupFolder />} onSelect={() => (onMove(typed), onClose())} />}
          {p.group && !p.folderGroup?.derived && <MenuItem label={t('launcher.group.remove')} onSelect={() => (onMove(''), onClose())} />}
        </>
      )}
    </Menu>
  );
}

export function NewTile({ kind, onClick }: { kind: ProjectKind; onClick: () => void }) {
  const { t } = useTranslation();
  const k = KIND[kind];
  return (
    <button className={`lcard lnew t-${k.tone}`} onClick={onClick} data-new={kind}>
      <span className="ic">
        <KindIcon kind={kind} size={22} />
      </span>
      <span className="txt">
        <span className="name">{t(`launcher.kind.${kind}.new`)}</span>
        <span className="blurb">{t(`launcher.kind.${kind}.blurb`)}</span>
      </span>
    </button>
  );
}
