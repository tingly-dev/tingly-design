import { useEffect, useMemo, useRef, useState } from 'react';
import { componentNames, parseCardMarker, type DsIndex, type DsTokens } from '@dc/core';
import { api } from '../../api';
import { FONT_RE, IMAGE_RE, markdown, previewDoc, rawUrl, uploadTo, useAssets, assetsChanged, type AssetFile } from '../../ds';
import { display, edit, toast, useStore } from '../../store';

/** Rendered markdown (sanitized: it was written by people). */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => markdown(text), [text]);
  return <div className={`md ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

let frameSeq = 0;

/** One live preview: a sandboxed frame with the system's tokens, bundle and libraries loaded first. */
export function Preview({ comp, html, t, index, theme, minHeight }: { comp: string; html: string; t: DsTokens; index: DsIndex; theme: string; minHeight?: number }) {
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
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.dsPreview === id && typeof e.data.height === 'number') setH(Math.min(4000, Math.max(marker.height ?? 40, e.data.height)));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [id, marker.height]);
  return <iframe className="dspreview" title={`${comp} 预览`} sandbox="allow-scripts" srcDoc={doc} style={{ height: h }} />;
}

function SourceEditor({ path, label }: { path: string; label: string }) {
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
          保存
        </button>
      </div>
    </div>
  );
}

export function ComponentsView({ t, index, theme }: { t: DsTokens; index: DsIndex; theme: string }) {
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
    const n = prompt('组件名（英文标识符，如 Button）')?.trim();
    if (!n || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n)) return;
    edit(`components/${n}/README.md`, () => `# ${n}\n\n一句话说明它是什么、什么时候用。\n`, { actor: 'human', summary: `component ${n} added`, undoable: false });
    edit(`components/${n}/preview.html`, () => `<!-- @dsCard group="Components" height=120 -->\n<!doctype html>\n<html>\n<head><meta charset="utf-8"></head>\n<body>\n<div style="padding:16px;border-radius:var(--radius-m, 8px);background:var(--surface-raised, #fff);color:var(--ink, #1d1d1b)">${n}</div>\n</body>\n</html>\n`, { actor: 'human', summary: `component ${n} preview added`, undoable: false });
  };
  return (
    <section className="dsview" aria-label="组件">
      <header>
        <h2>组件</h2>
        <span className="hint">
          {names.length} 个{index.namespace ? ` · window.${index.namespace}` : ''}
        </span>
        <button className="btn outline" onClick={add}>
          + 添加组件
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
                    {code === n ? '收起源文件' : '源文件'}
                  </button>
                </div>
                {html ? <Preview comp={n} html={html} t={t} index={index} theme={theme} /> : <p className="hint">没有 preview.html。</p>}
                {readme && <Markdown text={readme.replace(new RegExp(`^#\\s*${n}\\s*\\n`), '')} className="guide" />}
                {code === n && (
                  <>
                    <SourceEditor path={`components/${n}/preview.html`} label={`${n} 的预览源文件`} />
                    <SourceEditor path={`components/${n}/README.md`} label={`${n} 的使用说明`} />
                  </>
                )}
              </article>
            );
          })}
        </div>
      ))}
      {!names.length && <p className="hint">还没有组件。从代码库生成组件、写 bundle.js 和预览，适合交给 Claude Code。</p>}
      {bundle !== undefined && (
        <div className="dsgroup">
          <h3>bundle</h3>
          <p className="hint">components/bundle.js 定义 window.{index.namespace}；每个预览都会先加载它和 tokens.css、bundle.css。</p>
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
  const project = useStore((s) => s.project);
  const name = a.path.slice(a.path.lastIndexOf('/') + 1);
  return (
    <figure className="tile" data-asset={a.path}>
      <div className="tv">
        {IMAGE_RE.test(a.path) ? (
          <img src={rawUrl(a.path)} alt={name} loading="lazy" />
        ) : FONT_RE.test(a.path) ? (
          <span className="spec">Aa 字</span>
        ) : (
          <span className="hint">{name.slice(name.lastIndexOf('.') + 1).toUpperCase()}</span>
        )}
      </div>
      <figcaption>
        <span title={a.path}>{name}</span>
        <span className="hint">{a.size < 1024 ? `${a.size} B` : `${Math.round(a.size / 1024)} KB`}</span>
        <a className="ib" href={rawUrl(a.path)} download={name} aria-label={`下载 ${name}`} title="下载">
          ↓
        </a>
        <button
          className="ib"
          aria-label={`删除 ${name}`}
          title="删除"
          onClick={async () => {
            if (!project || !confirm(`删除 ${a.path}？`)) return;
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
    <section className="dsview" aria-label="资源">
      <header>
        <h2>资源</h2>
        <span className="hint">标志、图标、图片和字体。拖文件到这里，或按组上传。</span>
        <button
          className="btn outline"
          onClick={() => {
            const g = prompt('新的分组名（如 Logos、Icons）')?.trim();
            if (g && /^[A-Za-z0-9_][A-Za-z0-9_ -]{0,60}$/.test(g)) pick(`assets/${g}`);
          }}
        >
          + 新分组
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
                  + 上传
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
        {!groups.length && <p className="hint">还没有资源。把文件拖到这里。</p>}
      </div>
    </section>
  );
}
