import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { editFields, retypeKind, type EditField } from '@dc/core';
import { api } from '../api';
import { closeExpand, commitField, firstField } from '../expand';
import { display, parsed, toast, useStore } from '../store';
import { Close } from './icons';
import { Field } from './panel/fields';

/**
 * What an element holds, as one form (`.design/expand-to-edit.md`): its fields
 * from core's `editFields`, in reading order, a picture's source with a picker,
 * a link's address, a paragraph's runs. It is drawn in two places: the popover
 * a double-click (or Enter) opens next to the element, and the Content section of
 * the Properties panel. A field that cannot be written says why instead of
 * being a dead box.
 */

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const ABSOLUTE = /^(https?:|data:|blob:|\/)/i;

/** The form for the element `tid` of `file`: at most `limit` fields, the rest summarised. */
export function ContentForm({ file, tid, near, limit, autoFocus }: { file: string; tid: number; near?: string; limit: number; autoFocus?: boolean }) {
  const { t } = useTranslation();
  const source = useStore((s) => display(s, file));
  const doc = source ? parsed(source) : null;
  const el = doc?.elements[tid];
  const all = doc && el ? editFields(doc, el) : [];
  const fields = all.slice(0, limit);
  const focusKey = autoFocus ? firstField(fields, near)?.key : undefined;
  const hover = (on: boolean, id: number) => useStore.setState({ layerHover: on ? { file, tid: id } : null });
  // clear the outline on the artboard when the form goes away with the pointer still over a row
  useEffect(() => () => useStore.setState((s) => (s.layerHover?.file === file ? { layerHover: null } : {})), [file]);

  // consecutive fields of one picture, link or input make one block with a heading; text runs stand alone
  const blocks: { key: string; role: EditField['role']; owner: number; fields: EditField[] }[] = [];
  for (const f of fields) {
    const last = blocks.at(-1);
    const grouped = f.role !== 'text' && last && last.role === f.role && last.owner === f.owner;
    if (grouped) last.fields.push(f);
    else blocks.push({ key: f.key, role: f.role, owner: f.owner, fields: [f] });
  }
  return (
    <div className="cform">
      {all.some((f) => f.repeated) && <p className="hint">{t('expand.repeated')}</p>}
      {blocks.map((b) => (
        <div key={b.key} className={`cblock ${b.role}`} onMouseEnter={() => hover(true, b.owner)} onMouseLeave={() => hover(false, b.owner)}>
          {b.role !== 'text' && <h4>{t(`expand.role.${b.role}`)}</h4>}
          {b.fields.map((f) => (
            <FieldRow key={f.key} file={file} field={f} focus={f.key === focusKey} />
          ))}
        </div>
      ))}
      {all.length > fields.length && <p className="hint">{t('expand.more', { count: all.length - fields.length })}</p>}
    </div>
  );
}

function FieldRow({ file, field, focus }: { file: string; field: EditField; focus: boolean }) {
  const { t } = useTranslation();
  const readonly = field.binding.kind === 'readonly';
  const label = field.kind === 'text' ? (field.role === 'link' ? t('expand.field.label') : t('expand.field.text')) : t(`expand.field.${field.kind}`);
  const put = (v: string) => commitField(file, field, v);
  const note = field.binding.kind === 'tweak' ? t('expand.tweak', { name: field.binding.prop }) : field.binding.kind === 'readonly' ? t(`expand.readonly.${field.binding.why}`) : null;
  let control: React.ReactNode;
  if (field.kind === 'newTab')
    control = (
      <label className="check">
        <input type="checkbox" checked={field.value === 'on'} disabled={readonly} onChange={(e) => put(e.currentTarget.checked ? 'on' : '')} />
        {label}
      </label>
    );
  else if (field.kind === 'src') control = <PictureRow file={file} field={field} focus={focus} onPut={put} />;
  else if (field.kind === 'text') control = <RunInput value={field.value} label={label} readonly={readonly} focus={focus} onCommit={put} />;
  else
    control = <Line value={field.value} label={label} readonly={readonly} focus={focus} onCommit={put} />;
  return (
    <div className="crow">
      {/* a run of text is its own label; the other fields say what they are */}
      {field.kind !== 'newTab' && field.kind !== 'src' && !(field.kind === 'text' && field.role === 'text') && <span className="lab">{label}</span>}
      {control}
      {note && <p className={`hint ${readonly ? 'ro' : ''}`}>{note}</p>}
    </div>
  );
}

/** One line, committed on Enter or blur; the panel's `Field`, focused when the form opens on it. */
function Line({ value, label, readonly, focus, onCommit }: { value: string; label: string; readonly: boolean; focus: boolean; onCommit: (v: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useFocus(box, focus);
  return (
    <div ref={box} className={readonly ? 'ro' : ''}>
      <Field value={value} numeric={false} label={label} onCommit={(v) => !readonly && onCommit(v)} />
    </div>
  );
}

/** A run of text: a few lines when it is long, Enter commits, Shift+Enter is nothing (a run is one paragraph of words). */
function RunInput({ value, label, readonly, focus, onCommit }: { value: string; label: string; readonly: boolean; focus: boolean; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(value);
  }, [value]);
  useFocus(ref, focus);
  const done = () => {
    editing.current = false;
    if (text !== value && !readonly) onCommit(text);
  };
  return (
    <textarea
      ref={ref}
      className={`crun ${readonly ? 'ro' : ''}`}
      rows={Math.min(4, Math.max(1, Math.ceil(text.length / 34)))}
      value={text}
      readOnly={readonly}
      aria-label={label}
      onFocus={() => (editing.current = true)}
      onChange={(e) => setText(e.target.value.replace(/\n/g, ' '))}
      onBlur={done}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setText(value);
          editing.current = false;
          setTimeout(() => ref.current?.blur());
        }
      }}
    />
  );
}

/** Focus and select the first input inside `ref` (or the element itself) once, when asked. */
function useFocus(ref: React.RefObject<HTMLElement | null>, on: boolean) {
  useLayoutEffect(() => {
    if (!on) return;
    const node = ref.current;
    const input = node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement ? node : node?.querySelector('input');
    input?.focus();
    input?.select();
    // once, when the form opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ---------------------------------------------------------------- pictures

/** A picture's source: its thumbnail, the address as written, and a picker of the project's own pictures. */
function PictureRow({ file, field, focus, onPut }: { file: string; field: EditField; focus: boolean; onPut: (v: string) => void }) {
  const { t } = useTranslation();
  const project = useStore((s) => s.project);
  const [open, setOpen] = useState(false);
  const readonly = field.binding.kind === 'readonly';
  const box = useRef<HTMLDivElement>(null);
  useFocus(box, focus);
  const shown = field.value && !field.value.includes('{{') ? (ABSOLUTE.test(field.value) || !project ? field.value : api.rawBase(project) + field.value) : '';
  return (
    <div className="cpic" ref={box}>
      <div className="cpic-head">
        <span className="thumb" aria-hidden={!shown}>
          {shown && <img src={shown} alt="" draggable={false} />}
        </span>
        <div className={`cpic-src ${readonly ? 'ro' : ''}`}>
          <Field value={field.value} numeric={false} label={t('expand.field.src')} onCommit={(v) => !readonly && onPut(v.trim())} />
        </div>
        {!readonly && (
          <button className="btn sm outline" aria-expanded={open} onClick={() => setOpen(!open)}>
            {t('expand.picture.replace')}
          </button>
        )}
      </div>
      {open && !readonly && (
        <PicturePicker
          current={field.value}
          onPick={(path) => {
            onPut(path);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** The project's pictures (newest first) and an upload tile: choosing one writes its path, nothing is copied. */
function PicturePicker({ current, onPick }: { current: string; onPick: (path: string) => void }) {
  const { t } = useTranslation();
  const project = useStore((s) => s.project);
  const rev = useStore((s) => s.assetRev);
  const [pics, setPics] = useState<{ path: string; mtime: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!project) return;
    let live = true;
    api
      .entries(project)
      .then((r) => live && setPics(r.entries.filter((e) => IMAGE.test(e.path)).sort((a, b) => b.mtime - a.mtime).slice(0, 60)))
      .catch(() => live && setPics([]));
    return () => {
      live = false;
    };
  }, [project, rev]);
  const upload = async (file: File) => {
    if (!project) return;
    setBusy(true);
    try {
      const kept = await api.upload(project, file, 'uploads');
      onPick(kept.path);
    } catch (e) {
      toast(t('expand.picture.uploadFailed', { message: (e as Error).message }), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cpicker" role="listbox" aria-label={t('expand.picture.replace')}>
      <button className="tile up" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? t('expand.picture.uploading') : t('expand.picture.upload')}
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => e.currentTarget.files?.[0] && void upload(e.currentTarget.files[0])} />
      {(pics ?? []).map((p) => (
        <button key={p.path} className="tile" role="option" aria-selected={p.path === current} title={p.path} aria-label={t('expand.picture.pick', { name: p.path })} onClick={() => onPick(p.path)}>
          <img src={api.entryUrl(project!, p.path)} alt="" loading="lazy" draggable={false} />
        </button>
      ))}
      {pics && !pics.length && <p className="hint">{t('expand.picture.noneYet')}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- the two places

/** The popover a double-click or Enter opens next to the element. */
export function ExpandPanel() {
  const { t } = useTranslation();
  const at = useStore((s) => s.expand);
  const sel = useStore((s) => s.selection);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const leaves = !at || sel?.kind !== 'el' || sel.file !== at.file || sel.tid !== at.tid;
  // the form belongs to the element it opened on: selecting another closes it
  useEffect(() => {
    if (at && leaves) closeExpand();
  }, [at, leaves]);
  useEffect(() => {
    if (!at) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) closeExpand();
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [at]);
  // below the element, or above it when the form would run off the window; kept inside the window sideways
  useLayoutEffect(() => {
    if (!at || !box.current) return setPos(null);
    const r = box.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(at.x, innerWidth - r.width - 8));
    const below = at.y + 8;
    setPos({ left, top: below + r.height > innerHeight - 8 ? Math.max(8, innerHeight - r.height - 8) : below });
  }, [at]);
  if (!at || leaves) return null;
  return (
    <div
      ref={box}
      className="cpop"
      role="dialog"
      aria-label={t('expand.popover')}
      style={{ left: pos?.left ?? at.x, top: pos?.top ?? at.y + 8, opacity: pos ? 1 : 0 }}
      // Esc closes the form from any field, a field's own Esc (which stops the key) included; what was typed and not committed is dropped
      onKeyDownCapture={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          closeExpand();
        }
      }}
    >
      <header>
        <span>{t('expand.popover')}</span>
        <button className="ib sm" aria-label={t('expand.close')} title={t('expand.close')} onClick={closeExpand}>
          <Close />
        </button>
      </header>
      <ContentForm file={at.file} tid={at.tid} near={at.near} limit={24} autoFocus />
    </div>
  );
}

/** The Properties panel's Content section: the same form for the selected element, nothing when it holds nothing to edit by hand. */
export function ContentSection({ file, tid }: { file: string; tid: number }) {
  const { t } = useTranslation();
  const count = useStore((s) => {
    const src = display(s, file);
    const doc = src ? parsed(src) : null;
    const el = doc?.elements[tid];
    if (!doc || !el) return 0;
    const fields = editFields(doc, el);
    // text that can be retyped in place is edited there; the section is for what is not text (a link's address, a picture)
    const inPlace = retypeKind(doc, el);
    return inPlace && inPlace !== 'data' && fields.every((f) => f.kind === 'text') ? 0 : fields.length;
  });
  // while the popover shows this element's form, the panel does not repeat it
  const open = useStore((s) => s.expand?.file === file && s.expand.tid === tid);
  if (!count || open) return null;
  return (
    <div className="sec content">
      <h3>{t('expand.title')}</h3>
      <ContentForm file={file} tid={tid} limit={8} />
    </div>
  );
}
