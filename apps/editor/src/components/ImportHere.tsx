import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { importErrorText } from '@dc/import';
import { clipText, toast, useStore } from '../store';
import { api } from '../api';
import { t as tNow } from '../i18n';
import { droppedFiles, pickedFromText, readPicked, type Picked } from '../importer';
import { Menu, MenuItem } from './Menu';
import { BoardPicker } from './BoardPicker';
import { FileText, Frame, ImportI } from './icons';

/**
 * Bringing outside material into the project that is open: one button, a
 * drop anywhere on the editor, or a paste. What happens is decided by the
 * project's kind and the files themselves, never by a mode the person picks
 * first: a page dropped on a canvas becomes artboards, a CSV dropped on a
 * dashboard becomes a dataset. Each kind describes what it takes as an
 * ImportTarget; this component is the same in every editor.
 */

/** What a file is, as far as importing goes. */
export type Material = 'page' | 'drawing' | 'image' | 'markdown' | 'data' | 'font';

// image is what the server keeps in uploads/ (no AVIF there); each one's name in words is importer.material.<material>
const MATERIAL: Record<Material, { ext: RegExp; accept: string }> = {
  page: { ext: /\.html?$/i, accept: '.html,.htm,.css' },
  drawing: { ext: /\.svg$/i, accept: '.svg' },
  image: { ext: /\.(png|jpe?g|gif|webp)$/i, accept: 'image/png,image/jpeg,image/gif,image/webp' },
  markdown: { ext: /\.(md|markdown|txt)$/i, accept: '.md,.markdown,.txt' },
  data: { ext: /\.(csv|tsv|tab|json)$/i, accept: '.csv,.tsv,.tab,.json' },
  font: { ext: /\.(woff2?|ttf|otf)$/i, accept: '.woff2,.woff,.ttf,.otf' },
};

export function materialOf(path: string): Material | null {
  for (const [m, d] of Object.entries(MATERIAL) as [Material, (typeof MATERIAL)[Material]][]) if (d.ext.test(path)) return m;
  return null;
}

/** The picked files of the given materials, in pick order. */
export function filesOf(picked: Picked, ...kinds: Material[]): Picked['files'] {
  return picked.files.filter((f) => kinds.includes(materialOf(f.path) as Material));
}

export interface ImportTarget {
  /** what this kind takes; a pick holding none of it is refused with this list */
  accepts: Material[];
  /**
   * What this kind takes from another project: an artboard of a canvas, copied
   * in by the server and then put on the page by `place` (see
   * .design/import-from-project.md). Absent: the kind takes nothing from projects.
   */
  board?: {
    /** one line, said where people pick an artboard */
    readonly what: string;
    /** put the imported copy on the page; resolves to what to tell the person */
    place: (path: string, info: { size: [number, number]; moving: boolean; title: string }) => string;
  };
  /** one line, said where people choose: what each material becomes here (in the language showing: a getter over t()) */
  what: string;
  /** do it; resolves to what to tell the person when it is done. `at` is where a drop landed, in screen px */
  run: (picked: Picked, at?: { x: number; y: number }) => Promise<string>;
}

const busyText = (p: Picked) =>
  p.entry ? p.entry.split('/').pop()! : p.files.length === 1 ? p.files[0].path.split('/').pop()! : tNow('importer.here.files', { count: p.files.length });

/** Is the person typing somewhere? Then a paste is theirs, not an import. */
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

/**
 * The import button (unless `button` is false), plus a drop target over the
 * whole editor and a paste handler. Drops and pastes that another part of the
 * editor already handled (the prompt bar's attachments, a drop zone) are left
 * alone.
 *
 * `label` is the open project's kind as a noun in the language showing
 * ("canvas" / "画布"), said as "Import into this {label}".
 */
/** What a shared menu needs to start an import without drawing the button: open the pickers, say whether one is running. */
export interface ImportControls {
  chooseFiles(): void;
  chooseFolder(): void;
  /** open the artboard picker (only for a target with `board`) */
  pickProject(): void;
}

export function ImportHere({ target, label, button = 'icon', controls }: { target: ImportTarget; label: string; button?: 'icon' | 'text' | false; controls?: MutableRefObject<ImportControls | null> }) {
  const { t: tr } = useTranslation();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dropping, setDropping] = useState(false);
  const [busy, setBusy] = useState('');
  const [picking, setPicking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const live = useRef({ target, busy });
  live.current = { target, busy };

  const take = async (picked: Picked, at?: { x: number; y: number }) => {
    const t = live.current.target;
    if (live.current.busy) return;
    if (!picked.files.some((f) => t.accepts.includes(materialOf(f.path) as Material))) {
      // tNow, not the hook's t: drops and pastes reach this through an effect set up on the first render
      toast(tNow('importer.here.accepts', { list: t.accepts.map((m) => tNow(`importer.material.${m}`)).join(tNow('importer.listSeparator')) }), 'error');
      return;
    }
    setBusy(busyText(picked));
    try {
      toast(await t.run(picked, at));
    } catch (e) {
      toast(importErrorText(e, tNow), 'error');
    } finally {
      setBusy('');
    }
  };
  const takeList = async (list: { file: File; path: string }[], at?: { x: number; y: number }) => {
    if (list.length) await take(await readPicked(list), at);
  };

  useEffect(() => dirRef.current?.setAttribute('webkitdirectory', ''), []);
  useEffect(() => {
    if (!controls) return;
    controls.current = { chooseFiles: () => fileRef.current?.click(), chooseFolder: () => dirRef.current?.click(), pickProject: () => setPicking(true) };
    return () => {
      controls.current = null;
    };
  }, [controls]);
  useEffect(() => {
    let depth = 0;
    const end = () => {
      document.body.classList.remove('filedrag');
      setDropping(false);
    };
    const files = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!files(e)) return;
      depth++;
      // frames (artboards, the slide, the dashboard page) would swallow the drop
      document.body.classList.add('filedrag');
      setDropping(true);
    };
    const leave = (e: DragEvent) => {
      if (!files(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) end();
    };
    const over = (e: DragEvent) => {
      if (files(e) && !e.defaultPrevented) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      end();
      if (!files(e) || e.defaultPrevented) return;
      e.preventDefault();
      const at = { x: e.clientX, y: e.clientY };
      void droppedFiles(e.dataTransfer!).then((list) => takeList(list, at));
    };
    const paste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || typing(e.target) || typing(document.activeElement)) return;
      const cd = e.clipboardData;
      if (!cd) return;
      const list = [...cd.files].map((file, i) => ({ file, path: file.name || `pasted-${i + 1}.${file.type.split('/')[1] ?? 'bin'}` }));
      const text = cd.getData('text/plain');
      // an element copied in the editor that holds an SVG is pasted as that element
      const svg = list.length || (text && text === clipText()) ? null : pickedFromText(text);
      const t = live.current.target;
      if (svg && t.accepts.includes('drawing')) {
        e.preventDefault();
        void take(svg);
      } else if (list.some((f) => t.accepts.includes(materialOf(f.path) as Material))) {
        e.preventDefault();
        void takeList(list);
      }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
      end();
    };
  }, []);

  const accept = target.accepts.map((m) => MATERIAL[m].accept).join(',');
  const fromInput = (input: HTMLInputElement) => {
    const list = [...(input.files ?? [])].map((file) => ({ file, path: file.webkitRelativePath || file.name }));
    input.value = '';
    void takeList(list);
  };
  return (
    <>
      {button && (
        <button
          ref={btn}
          className={button === 'text' ? 'btn ghost' : 'tb'}
          title={tr('importer.here.into', { label })}
          aria-label={tr('importer.here.into', { label })}
          aria-haspopup="menu"
          disabled={!!busy}
          onClick={() => {
            const r = btn.current!.getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom + 8 });
          }}
        >
          {button === 'text' ? tr('importer.here.button') : <ImportI />}
        </button>
      )}
      {menu && (
        <Menu x={menu.x} y={menu.y} label={tr('importer.here.button')} onClose={() => setMenu(null)}>
          <div className="head">{tr('importer.here.into', { label })}</div>
          <div className="mhint">{target.what}</div>
          <MenuItem
            label={tr('importer.here.chooseFiles')}
            icon={<FileText />}
            onSelect={() => {
              setMenu(null);
              fileRef.current?.click();
            }}
          />
          {(target.accepts.includes('page') || target.accepts.includes('markdown')) && (
            <MenuItem
              label={tr('importer.here.chooseFolder')}
              icon={<FileText />}
              onSelect={() => {
                setMenu(null);
                dirRef.current?.click();
              }}
            />
          )}
          {target.board && (
            <MenuItem
              label={tr('importer.here.fromProject')}
              icon={<Frame />}
              onSelect={() => {
                setMenu(null);
                setPicking(true);
              }}
            />
          )}
          <div className="mhint faint">{target.accepts.includes('drawing') || target.accepts.includes('image') ? tr('importer.here.dragOrPaste') : tr('importer.here.drag')}</div>
        </Menu>
      )}
      <input ref={fileRef} type="file" multiple hidden accept={accept} onChange={(e) => fromInput(e.currentTarget)} />
      <input ref={dirRef} type="file" hidden onChange={(e) => fromInput(e.currentTarget)} />
      {dropping && (
        <div className="importdrop" aria-hidden="true">
          <div>
            <b>{tr('importer.here.dropInto', { label })}</b>
            <span>{target.what}</span>
          </div>
        </div>
      )}
      {picking && target.board && (
        <BoardPicker
          what={target.board.what}
          onClose={() => setPicking(false)}
          onPick={async (from, board, title, moving) => {
            setPicking(false);
            setBusy(title);
            try {
              const project = useStore.getState().project;
              if (!project) return;
              const r = await api.importBoard(project, from, board);
              toast(live.current.target.board!.place(r.record.path, { size: r.size, moving, title }));
            } catch (e) {
              toast((e as Error).message, 'error');
            } finally {
              setBusy('');
            }
          }}
        />
      )}
      {busy && (
        <div className="importbusy" role="status">
          {tr('importer.here.busy', { name: busy })}
        </div>
      )}
    </>
  );
}
