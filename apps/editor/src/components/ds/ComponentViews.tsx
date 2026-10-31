import { useEffect, useMemo, useRef, useState } from 'react';
import { askConfirm } from '../ConfirmDialog';
import { componentNames, parseCardMarker, type DsIndex, type DsTokens } from '@dc/core';
import { api } from '../../api';
import { FONT_RE, IMAGE_RE, markdown, previewDoc, rawUrl, uploadTo, useAssets, assetsChanged, type AssetFile } from './ds';
import { display, edit, toast, useStore } from '../../store';
import { useTranslation } from 'react-i18next';

/** Rendered markdown (sanitized: it was written by people). */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => markdown(text), [text]);
  return <div className={`md ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

let frameSeq = 0;

/** One live preview: a sandboxed frame with the system's tokens, bundle and libraries loaded first. */
export function Preview({ comp, html, t, index, theme, minHeight }: { comp: string; html: string; t: DsTokens; index: DsIndex; theme: string; minHeight?: number }) {
  const { t: tr } = useTranslation();
  const bundleJs = useStore((s) => display(s, 'components/bundle.js'));
  const bundleCss = useStore((s) => display(s, 'components/bundle.css'));
  const files = useStore((s) => s.files);
  const libFiles = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [p, e] of Object.entries(files)) if (p.startsWith('components/lib/') && e.server) out[p] = e.server.content;
    return out;
  }, [files]);
  const [id] = useState(() => `p${++frameSeq}`);
  const marker = parseCardMarker(html);
  const [h, setH] = useState(marker.height ?? minHeight ?? 120);
  const doc = useMemo(
    () => previewDoc({ html, comp, theme, tokens: t, title: index.title, bundleJs, bundleCss, libraries: index.libraries, libFiles, frameId: id }),
    [html, comp, theme, t, index.title, index.libraries, bundleJs, bundleCss, libFiles, id],
  );
  // Two frames take turns: the one shown stays while the next document loads in
  // a hidden twin, and the swap waits for the twin's load — a burst of writes to
  // the bundle (Claude Code working on the system) never blanks the preview.
  const [active, setActive] = useState(0);
  const [docs, setDocs] = useState<{ 0: string | null; 1: string | null }>({ 0: doc, 1: null });
  const [gen, setGen] = useState<[number, number]>([0, 0]);
  const frames = [useRef<HTMLIFrameElement>(null), useRef<HTMLIFrameElement>(null)];
  const activeRef = useRef(0);
  activeRef.current = active;
  useEffect(() => {
    if (doc === docs[0] || doc === docs[1]) return;
    const slot = active === 0 ? 1 : 0;
    setDocs((d) => ({ ...d, [slot]: doc }));
    setGen((g) => (slot === 0 ? [g[0] + 1, g[1]] : [g[0], g[1] + 1]));
  }, [doc, active, docs]);
  // the twin has loaded: it takes over, and the frame it replaces goes away until the next boot
  const promote = (slot: 0 | 1) => {
    setActive(slot);
    setDocs((d) => ({ ...d, [slot === 0 ? 1 : 0]: null }));
  };
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      // the twin also measures while it loads: only the frame on show moves the card's height
      const fromShown = e.source === frames[activeRef.current]?.current?.contentWindow;
      if (fromShown && e.data?.dsPreview === id && typeof e.data.height === 'number') setH(Math.min(4000, Math.max(marker.height ?? 40, e.data.height)));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [id, marker.height]);
  const title = tr('ds.components.previewTitle', { comp });
  const frame = (slot: 0 | 1) => {
    const src = docs[slot];
    return src === null ? null : (
      <iframe
        key={`${slot}${gen[slot]}`}
        ref={frames[slot]}
        className={active === slot ? 'dspreview' : 'dspreview next'}
        title={title}
        sandbox="allow-scripts"
        srcDoc={src}
        style={{ height: h }}
        onLoad={() => promote(slot)}
      />
    );
  };
  return (
    <div className="dsframe">
      {frame(0)}
      {frame(1)}
    </div>
  );
}

function SourceEditor({ path, label }: { path: string; label: string }) {
  const { t: tr } = useTranslation();
  const source = useStore((s) => display(s, path)) ?? '';
  const [text, setText] = useState(source);
  const dirty = text !== source;
  useEffect(() => setText(source), [source]);
  return (
    <div className="srcedit">
      <textarea className="code" value={text} aria-label={label} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} spellCheck={false} />
      <div className="acts">
        <span className="hint">{path}</span>
        <button className="btn primary" disabled={!dirty} onClick={() => edit(path, () => text, { actor: 'human', summary: `${path} edited` })}>
          {tr('common.save')}
        </button>
      </div>
    </div>
  );
}

export function ComponentsView({ t, index, theme }: { t: DsTokens; index: DsIndex; theme: string }) {
  const { t: tr } = useTranslation();
  const files = useStore((s) => s.files);
  const bundle = useStore((s) => display(s, 'components/bundle.js'));
  const names = useMemo(() => componentNames(Object.keys(files), bundle), [files, bundle]);
  const [code, setCode] = useState<string | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const n of names) {
      const html = files[`components/${n}/preview.html`]?.server?.content ?? '';
      const g = parseCardMarker(html).group ?? '';
      m.set(g, [...(m.get(g) ?? []), n]);
    }
    return [...m.entries()];
  }, [names, files]);
  const add = () => {
    const n = prompt(tr('ds.components.namePrompt'))?.trim();
    if (!n || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n)) return;
    edit(`components/${n}/README.md`, () => `# ${n}\n\n${tr('ds.components.readmeStub')}\n`, { actor: 'human', summary: `component ${n} added`, undoable: false });
    edit(`components/${n}/preview.html`, () => `<!-- @dsCard group="Components" height=120 -->\n<!doctype html>\n<html>\n<head><meta charset="utf-8"></head>\n<body>\n<div style="padding:16px;border-radius:var(--radius-m, 8px);background:var(--surface-raised, #fff);color:var(--ink, #1d1d1b)">${n}</div>\n</body>\n</html>\n`, { actor: 'human', summary: `component ${n} preview added`, undoable: false });
  };
  return (
    <section className="dsview" aria-label={tr('ds.nav.components')}>
      <header>
        <h2>{tr('ds.nav.components')}</h2>
        <span className="hint">
          {tr('ds.components.count', { count: names.length })}
          {index.namespace ? ` · window.${index.namespace}` : ''}
        </span>
        <button className="btn outline" onClick={add}>
          {tr('ds.components.add')}
        </button>
      </header>
      {groups.map(([g, list]) => (
        <div key={g} className="dsgroup">
          {g && <h3>{g}</h3>}
          {list.map((n) => {
            const html = files[`components/${n}/preview.html`]?.server?.content;
            const readme = files[`components/${n}/README.md`]?.server?.content;
            const marker = html ? parseCardMarker(html) : {};
            return (
              <article key={n} className="comp" data-comp={n}>
                <div className="chead">
                  <h4>{n}</h4>
                  {marker.subtitle && <span className="hint">{marker.subtitle}</span>}
                  <button className="btn ghost" onClick={() => setCode(code === n ? null : n)} aria-pressed={code === n}>
                    {code === n ? tr('ds.components.hideSource') : tr('ds.components.source')}
                  </button>
                </div>
                {html ? <Preview comp={n} html={html} t={t} index={index} theme={theme} /> : <p className="hint">{tr('ds.components.noPreview')}</p>}
                {readme && <Markdown text={readme.replace(new RegExp(`^#\\s*${n}\\s*\\n`), '')} className="guide" />}
                {code === n && (
                  <>
                    <SourceEditor path={`components/${n}/preview.html`} label={tr('ds.components.sourceLabel', { name: n })} />
                    <SourceEditor path={`components/${n}/README.md`} label={tr('ds.components.readmeLabel', { name: n })} />
                  </>
                )}
              </article>
            );
          })}
        </div>
      ))}
      {!names.length && <p className="hint">{tr('ds.components.empty')}</p>}
      {bundle !== undefined && (
        <div className="dsgroup">
          <h3>bundle</h3>
          <p className="hint">{tr('ds.components.bundleHint', { name: index.namespace })}</p>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ assets

function groupOf(path: string): string {
  const m = /^assets\/([^/]+)\/./.exec(path);
  return m ? m[1] : path.startsWith('fonts/') ? 'Fonts' : 'Other';
}

function Tile({ a }: { a: AssetFile }) {
  const { t: tr } = useTranslation();
  const project = useStore((s) => s.project);
  const name = a.path.slice(a.path.lastIndexOf('/') + 1);
  return (
    <figure className="tile" data-asset={a.path}>
      <div className="tv">
        {IMAGE_RE.test(a.path) ? (
          <img src={rawUrl(a.path)} alt={name} loading="lazy" />
        ) : FONT_RE.test(a.path) ? (
          <span className="spec">{tr('ds.assets.fontSample')}</span>
        ) : (
          <span className="hint">{name.slice(name.lastIndexOf('.') + 1).toUpperCase()}</span>
        )}
      </div>
      <figcaption>
        <span title={a.path}>{name}</span>
        <span className="hint">{a.size < 1024 ? `${a.size} B` : `${Math.round(a.size / 1024)} KB`}</span>
        <a className="ib" href={rawUrl(a.path)} download={name} aria-label={tr('ds.assets.downloadName', { name })} title={tr('ds.assets.download')}>
          ↓
        </a>
        <button
          className="ib"
          aria-label={tr('ds.assets.deleteName', { name })}
          title={tr('common.delete')}
          onClick={async () => {
            if (!project || !(await askConfirm(tr('ds.assets.confirmDelete', { path: a.path })))) return;
            await api.removeAsset(project, a.path).catch((e) => toast(e.message, 'error'));
            assetsChanged();
          }}
        >
          ×
        </button>
      </figcaption>
    </figure>
  );
}

export function AssetsView({ index }: { index: DsIndex }) {
  const { t: tr } = useTranslation();
  const assets = useAssets().filter((a) => a.path.startsWith('assets/') || a.path.startsWith('fonts/'));
  const files = useStore((s) => s.files);
  const input = useRef<HTMLInputElement>(null);
  const target = useRef('assets/Other');
  const groups = useMemo(() => {
    const m = new Map<string, AssetFile[]>();
    for (const g of index.groups) m.set(g, []);
    for (const a of assets) m.set(groupOf(a.path), [...(m.get(groupOf(a.path)) ?? []), a]);
    for (const f of Object.keys(files)) {
      const g = /^assets\/([^/]+)\/README\.md$/.exec(f)?.[1];
      if (g && !m.has(g)) m.set(g, []);
    }
    return [...m.entries()];
  }, [assets, index.groups, files]);
  const pick = (dir: string) => {
    target.current = dir;
    input.current?.click();
  };
  return (
    <section className="dsview" aria-label={tr('ds.assets.title')}>
      <header>
        <h2>{tr('ds.assets.title')}</h2>
        <span className="hint">{tr('ds.assets.hint')}</span>
        <button
          className="btn outline"
          onClick={() => {
            const g = prompt(tr('ds.assets.groupPrompt'))?.trim();
            if (g && /^[A-Za-z0-9_][A-Za-z0-9_ -]{0,60}$/.test(g)) pick(`assets/${g}`);
          }}
        >
          {tr('ds.assets.newGroup')}
        </button>
      </header>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const fl = e.currentTarget.files;
          if (fl?.length) void uploadTo(target.current, fl);
          e.currentTarget.value = '';
        }}
      />
      <div
        className="drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) void uploadTo('assets/Other', e.dataTransfer.files);
        }}
      >
        {groups.map(([g, list]) => {
          const readme = files[`assets/${g}/README.md`]?.server?.content;
          const dir = g === 'Fonts' ? 'fonts' : g === 'Other' ? 'assets/Other' : `assets/${g}`;
          return (
            <div key={g} className="dsgroup" data-group={g}>
              <h3>
                {g} <span className="hint">{list.length}</span>
                <button className="btn ghost" onClick={() => pick(dir)}>
                  {tr('ds.assets.upload')}
                </button>
              </h3>
              {readme && <Markdown text={readme.replace(/^#[^\n]*\n/, '')} />}
              <div className="tiles">
                {list.map((a) => (
                  <Tile key={a.path} a={a} />
                ))}
              </div>
            </div>
          );
        })}
        {!groups.length && <p className="hint">{tr('ds.assets.empty')}</p>}
      </div>
    </section>
  );
}
