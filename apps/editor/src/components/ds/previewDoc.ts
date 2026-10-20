import { compileTokensCss, type DsTokens } from '@dc/core';
import { SERVER } from '../../base';

const escapeScript = (s: string) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const escapeStyle = (s: string) => s.replace(/<\/style/gi, '<\\/style');

/**
 * A component preview as the original frames it: tokens.css, bundle.css, the
 * libraries and bundle.js loaded first, `data-theme` on <html>, relative
 * paths resolving from the component's folder. It runs in a sandboxed frame
 * with no network beyond the pinned script CDNs and Google Fonts.
 */
export interface PreviewDocOptions {
  html: string;
  comp: string;
  theme: string;
  tokens: DsTokens;
  title: string;
  bundleJs?: string;
  bundleCss?: string;
  libraries: { name: string; version: string; file?: string }[];
  libFiles: Record<string, string>;
  frameId: string;
  /** the system's raw-file base (`api.rawBase(project)`): fonts, pictures and relative paths resolve from it */
  raw: string;
  /** keep re-measuring every half second (the editor's previews); a launcher card relies on the ResizeObserver alone */
  poll?: boolean;
}

export function framePreview(opts: PreviewDocOptions): string {
  const raw = opts.raw;
  const origin = SERVER;
  const css = compileTokensCss(opts.tokens, { title: opts.title, fontBase: raw });
  const libs = opts.libraries
    .map((l) => {
      const local = l.file ? opts.libFiles[l.file] : opts.libFiles[`components/lib/${l.name}.production.min.js`];
      if (local !== undefined) return `<script>${escapeScript(local)}</script>`;
      if ((l.name === 'react' || l.name === 'react-dom') && /^18/.test(l.version))
        return `<script src="https://cdn.jsdelivr.net/npm/${l.name}@18.3.1/umd/${l.name}.production.min.js"></script>`;
      return '';
    })
    .join('');
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    `font-src https://fonts.gstatic.com ${origin}/api/ data:`,
    `img-src ${origin}/api/ data: blob:`,
    `media-src ${origin}/api/ data: blob:`,
  ].join('; ');
  // the frame tells the page its height, so a card grows to fit
  const size = `<script>(function(){var last=0;function send(){var h=Math.ceil(document.documentElement.scrollHeight);if(h!==last){last=h;parent.postMessage({dsPreview:${JSON.stringify(opts.frameId)},height:h},'*')}}addEventListener('load',send);new ResizeObserver(send).observe(document.documentElement);${opts.poll === false ? '' : 'setInterval(send,500)'}})()</script>`;
  const prelude =
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<base href="${raw}components/${encodeURIComponent(opts.comp)}/">` +
    `<style>${escapeStyle(css)}</style>` +
    `<style>html,body{margin:0}body{padding:16px;background:var(--surface, #fff);color:var(--ink, inherit)}</style>` +
    (opts.bundleCss ? `<style>${escapeStyle(opts.bundleCss)}</style>` : '') +
    libs +
    (opts.bundleJs ? `<script>${escapeScript(opts.bundleJs)}</script>` : '') +
    size;
  let body = opts.html.replace(/^\s*<!--\s*@dsCard[^]*?-->/, '').replace(/<!doctype[^>]*>/i, '');
  body = body.replace(/<html\b[^>]*>/i, '').replace(/<\/html>/i, '');
  if (/<head\b[^>]*>/i.test(body)) body = body.replace(/<head\b[^>]*>/i, (m) => m + prelude);
  else body = `<head>${prelude}</head>` + body;
  return `<!doctype html><html data-theme="${opts.theme}">${body}</html>`;
}
