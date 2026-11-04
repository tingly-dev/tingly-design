import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uniqueNoteId } from '@dc/core';
import { api } from '../../api';
import { editCanvas, toast, useStore } from '../../store';
import { SideResizer } from '../SideResizer';
import { RowMenu } from '../RowMenu';
import { MenuItem } from '../Menu';
import { Dialog } from '../Dialog';
import { Close, FilePdf, FileText, FileZip } from '../icons';
import { download } from '../../local';
import { toCanvas } from './view';

/** A file of the project folder, as the files pane lists it. */
interface Entry {
  path: string;
  size: number;
  mtime: number;
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'];
const TEXT_EXTS = ['md', 'txt', 'json', 'csv', 'tsv', 'css', 'js', 'mjs', 'html', 'svg', 'xml', 'yml', 'yaml'];
const IMAGE_MAX = 800;
const TEXT_LIMIT = 200_000;

const ext = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase();

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** An image's real size; an unreadable one draws at the default note size. */
function sizeOfUrl(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 });
    img.onerror = () => resolve({ w: 400, h: 300 });
    img.src = url;
  });
}

/**
 * The canvas's files pane: the project folder as it is on disk — what the person
 * brought in, what a tool just wrote, beside the editor's own files. One side
 * pane of its own (not a panel tab), canvas only on purpose (.design/files-pane.md):
 * list, preview and copy path are kind-neutral, "put on canvas" is the canvas step.
 */
export function FilesPane() {
  const { t } = useTranslation();
  const project = useStore((s) => s.project);
  // the editor already merges every folder event (an edit, an upload, an outside write) into this number
  const assetRev = useStore((s) => s.assetRev);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<Entry | null>(null);

  useEffect(() => {
    let alive = true;
    api.entries(project!)
      .then((r) => {
        if (!alive) return;
        setEntries(r.entries);
        setFailed(false);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [project, assetRev]);

  const putOnCanvas = async (e: Entry) => {
    const s = useStore.getState();
    const name = e.path.split('/').pop()!;
    let src = e.path;
    // a note's src is served by /raw/, which reaches the editor's folders: anything
    // else is copied into uploads/ first (named by content, so the same file is kept once)
    if (!/^(uploads|assets|data|fonts|ds)\//.test(e.path)) {
      const bytes = await api.entryBytes(s.project!, e.path);
      const up = await api.upload(s.project!, new File([bytes], name, { type: 'application/octet-stream' }), 'uploads');
      src = up.path;
    }
    const { w, h } = await sizeOfUrl(api.entryUrl(s.project!, e.path));
    const k = Math.min(1, IMAGE_MAX / w, IMAGE_MAX / h);
    const iw = Math.round(w * k);
    const ih = Math.round(h * k);
    const { viewport, page } = s;
    const at = toCanvas(viewport.w / 2, viewport.h / 2);
    const ids: string[] = [];
    editCanvas((c) => {
      const id = uniqueNoteId(c, 'img');
      c.notes[id] = { kind: 'image', x: Math.round(at.x - iw / 2), y: Math.round(at.y - ih / 2), w: iw, h: ih, src, alt: name.replace(/\.[^.]+$/, ''), ...(page ? { page } : {}) };
      ids.push(id);
    }, `placed ${e.path}`);
    useStore.setState({ selection: { kind: 'note', id: ids[0] } });
    toast(t('files.placed', { name }));
  };

  const copyPath = async (e: Entry) => {
    await navigator.clipboard.writeText(e.path);
    toast(t('files.copied', { path: e.path }));
  };

  const downloadEntry = async (e: Entry) => {
    const buf = await api.entryBytes(useStore.getState().project!, e.path);
    download(e.path.split('/').pop()!, new Blob([buf]));
  };

  // one folder header above each group, in path order; the root's files come first, with no header
  let lastDir: string | null = null;
  const rows: React.ReactNode[] = [];
  for (const e of entries ?? []) {
    const dir = e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : '';
    if (dir !== lastDir) {
      lastDir = dir;
      if (dir) rows.push(
        <div className="fdir" key={`d/${dir}`}>
          {dir}/
        </div>,
      );
    }
    const name = e.path.split('/').pop()!;
    rows.push(
      <div className="frow" key={e.path}>
        <button className="fname" onClick={() => setPreview(e)} title={e.path}>
          {IMAGE_EXTS.includes(ext(e.path)) ? (
            <img className="fthumb" src={api.entryUrl(project!, e.path)} alt="" loading="lazy" />
          ) : ext(e.path) === 'pdf' ? (
            <FilePdf />
          ) : ['zip', 'pptx', 'docx'].includes(ext(e.path)) ? (
            <FileZip />
          ) : (
            <FileText />
          )}
          <span className="fnn">{name}</span>
        </button>
        <span className="fsize">{fmtSize(e.size)}</span>
        <RowMenu label={e.path}>
          {(close) => (
            <>
              {IMAGE_EXTS.includes(ext(e.path)) && (
                <MenuItem
                  label={t('files.menu.putOnCanvas')}
                  onSelect={() => {
                    close();
                    void putOnCanvas(e);
                  }}
                />
              )}
              <MenuItem
                label={t('files.menu.openNew')}
                onSelect={() => {
                  close();
                  window.open(api.entryUrl(project!, e.path), '_blank', 'noopener');
                }}
              />
              <MenuItem
                label={t('files.menu.download')}
                onSelect={() => {
                  close();
                  void downloadEntry(e);
                }}
              />
              <MenuItem
                label={t('files.menu.copyPath')}
                onSelect={() => {
                  close();
                  void copyPath(e);
                }}
              />
            </>
          )}
        </RowMenu>
      </div>,
    );
  }

  return (
    <aside className="filespane" aria-label={t('common.pane.files')}>
      <SideResizer id="files" edge="start" name={t('common.pane.files')} />
      <div className="tabs">
        <span className="ftitle">{t('files.label')}</span>
        <button className="ib x" aria-label={t('panel.closeLabel')} title={t('panel.closeTitle')} onClick={() => useStore.setState({ pane: null })}>
          <Close />
        </button>
      </div>
      <div className="fbody">
        {failed ? (
          <div className="fempty">{t('files.loadFailed')}</div>
        ) : entries && !entries.length ? (
          <div className="fempty">{t('files.empty')}</div>
        ) : (
          rows
        )}
      </div>
      {preview && <FilePreview project={project!} entry={preview} onPlace={() => void putOnCanvas(preview)} onDownload={() => void downloadEntry(preview)} onClose={() => setPreview(null)} />}
    </aside>
  );
}

/** A file opened from the list: pictures drawn, text read only, the rest pointed at a new window. */
function FilePreview({ project, entry, onPlace, onDownload, onClose }: { project: string; entry: Entry; onPlace: () => void; onDownload: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const name = entry.path.split('/').pop()!;
  const kind = IMAGE_EXTS.includes(ext(entry.path)) ? 'image' : TEXT_EXTS.includes(ext(entry.path)) ? 'text' : 'other';
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    if (kind !== 'text') return;
    let alive = true;
    api.entryBytes(project, entry.path)
      .then((buf) => {
        if (!alive) return;
        const s = new TextDecoder().decode(new Uint8Array(buf));
        setTruncated(s.length > TEXT_LIMIT);
        setText(s.length > TEXT_LIMIT ? s.slice(0, TEXT_LIMIT) : s);
      })
      .catch(() => {
        if (alive) setText('');
      });
    return () => {
      alive = false;
    };
  }, [project, entry.path, kind]);
  return (
    <Dialog label={name} className="files-preview" onClose={onClose}>
      {kind === 'image' ? (
        <img src={api.entryUrl(project, entry.path)} alt={name} />
      ) : kind === 'text' ? (
        <pre>{text ?? ''}</pre>
      ) : (
        <div className="fp-none">{t('files.preview.noPreview')}</div>
      )}
      {truncated && <div className="fp-trunc">{t('files.preview.truncated', { limit: TEXT_LIMIT.toLocaleString() })}</div>}
      <div className="fp-foot">
        <span>{fmtSize(entry.size)}</span>
        <span style={{ flex: 1 }} />
        {kind === 'image' && (
          <button className="btn sm" onClick={onPlace}>
            {t('files.menu.putOnCanvas')}
          </button>
        )}
        <button className="btn sm outline" onClick={onDownload}>
          {t('files.menu.download')}
        </button>
        <a className="btn sm outline" href={api.entryUrl(project, entry.path)} target="_blank" rel="noopener">
          {t('files.preview.openNew')}
        </a>
      </div>
    </Dialog>
  );
}
