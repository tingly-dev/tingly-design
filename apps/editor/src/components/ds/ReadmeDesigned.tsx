import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { docLookCss, docLookFromSystem, hasDocStyles, lookFontCss, withoutConsumingGuide, type DsTokens } from '@dc/core';
import { api } from '../../api';
import { useStore } from '../../store';
import { markdown } from './ds';

/**
 * The README drawn as a document that wears this system and theme (.design/doc-design-system.md): the same
 * values and stylesheet the HTML export of a doc uses (`docLookFromSystem`, `docLookCss`), in a frame of its own so
 * the editor's styles do not reach it. The generated "Consuming this system" appendix is left out: it is variable
 * names and tables, for the agent that builds with the system.
 */
export function ReadmeDesigned({ text, tokens, theme }: { text: string; tokens: DsTokens; theme: string }) {
  const { t: tr } = useTranslation();
  const project = useStore((s) => s.project) ?? '';
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);
  const { page, note, had } = useMemo(() => {
    const trimmed = withoutConsumingGuide(text);
    const look = docLookFromSystem(tokens, theme);
    const raw = api.rawBase(project);
    const css = `${lookFontCss(tokens, raw)}
html{background:${look.page || '#ffffff'}}
body{max-width:${look.column ?? 720}px;margin:0 auto;padding:24px 8px 32px}
${docLookCss(look)}
img{max-width:100%}`;
    return {
      page: `<!doctype html><html><head><meta charset="utf-8"><base href="${raw}"><style>${css}</style></head><body>${markdown(trimmed.text)}</body></html>`,
      note: hasDocStyles(tokens),
      had: trimmed.had,
    };
  }, [text, tokens, theme, project]);
  // the frame is as tall as the page it holds; there is no scrolling inside it
  useEffect(() => {
    const f = frame.current;
    if (!f) return;
    let ro: ResizeObserver | undefined;
    const measure = () => {
      const d = f.contentDocument?.documentElement;
      if (d) setHeight(Math.max(120, Math.ceil(d.scrollHeight)));
    };
    const onLoad = () => {
      measure();
      const body = f.contentDocument?.body;
      if (body && typeof ResizeObserver !== 'undefined') {
        ro?.disconnect();
        ro = new ResizeObserver(measure);
        ro.observe(body);
      }
    };
    f.addEventListener('load', onLoad);
    return () => {
      f.removeEventListener('load', onLoad);
      ro?.disconnect();
    };
  }, [page]);
  return (
    <div className="readme-designed" data-testid="readme-designed">
      <p className="hint">
        {note ? tr('ds.readme.noteDoc') : tr('ds.readme.noteSizes')}
        {had && ` ${tr('ds.readme.noteAppendix')}`}
      </p>
      <iframe ref={frame} title={tr('ds.readme.frameTitle')} srcDoc={page} sandbox="allow-same-origin" style={{ height }} />
    </div>
  );
}
