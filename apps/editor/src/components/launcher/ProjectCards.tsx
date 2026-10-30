import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { type ProjectCard, type ProjectKind } from '@dc/core';
import { FileZip, GroupFolder, More, Rename, Unlink } from '../icons';
import { saveProjectArchive } from '../../projectArchive';
import { Menu, MenuItem } from '../Menu';
import { useElementSize } from '../../hooks';
import { Preview } from './Preview';
import { KIND, KindIcon } from './kinds';
import { open } from './recent';

function ago(t: TFunction, iso: string | null): string {
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

export function Card({ p, recent, flat, onMore }: { p: ProjectCard; recent: boolean; flat: boolean; onMore: (name: string, at: DOMRect) => void }) {
  const { t } = useTranslation();
  const [ref, { w: width }] = useElementSize<HTMLButtonElement>();
  const k = KIND[p.kind];
  const kindName = t(`launcher.kind.${p.kind}.name`);
  return (
    <div className="lcell">
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
        </div>
      </button>
      <MoreButton p={p} onMore={onMore} />
    </div>
  );
}

/** One project as a line: no preview, so a long list stays light. */
export function Row({ p, recent, onMore }: { p: ProjectCard; recent: boolean; onMore: (name: string, at: DOMRect) => void }) {
  const { t } = useTranslation();
  const k = KIND[p.kind];
  const kindName = t(`launcher.kind.${p.kind}.name`);
  return (
    <div className="lcell lrowcell">
      <button className={`lrow t-${k.tone}`} data-project={p.name} data-kind={p.kind} onClick={() => open(p.name)} aria-label={t('launcher.card.open', { title: p.title, kind: kindName })}>
        <span className="c-title">
          <span className="kic" title={kindName}>
            <KindIcon kind={p.kind} size={15} />
          </span>
          <span className="name">{p.title || p.name}</span>
          {recent && <span className="recent">{t('launcher.card.recent')}</span>}
        </span>
        <span className={`c-path${p.path ? ' far' : ''}`} title={p.path}>
          <bdi>{p.path ?? `projects/${p.name}`}</bdi>
        </span>
        <span className="c-group">{p.group ?? ''}</span>
        <span className="c-size">{t(`launcher.kind.${p.kind}.count`, { count: p.count })}</span>
        <span className="c-when">{p.updatedAt ? ago(t, p.updatedAt) : ''}</span>
      </button>
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
export function ProjectActions({ p, at, groups, onClose, onRename, onMove, onUnlink }: { p: ProjectCard; at: { x: number; y: number }; groups: string[]; onClose: () => void; onRename: (title: string) => void; onMove: (group: string) => void; onUnlink: () => void }) {
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
          <MenuItem label={t('launcher.group.moveTo')} icon={<GroupFolder />} onSelect={() => (setText(''), setStep('group'))} />
          <MenuItem label={t('launcher.archive.export')} icon={<FileZip />} onSelect={() => (onClose(), void saveProjectArchive(p.name, true))} />
          {p.path && !p.folderGroup && (
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
