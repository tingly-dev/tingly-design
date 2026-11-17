import { useEffect, useLayoutEffect, useMemo, useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { chatMarkdown } from '../chatMarkdown';

/**
 * What the AI answered, read as Markdown: paragraphs, lists, tables, quotes and headings in the
 * editor's own look, and a fenced code block framed with its language and a copy button. Links
 * open in a new tab and only http, https and mailto are followed; anything else is plain text.
 * The frame is `.run-result`, so selecting and copying the answer (#448) and the run card's
 * height work as before. See .design/conversation-markdown.md.
 */
export function ChatMarkdown({ text, bad }: { text: string; bad?: boolean }) {
  const { t } = useTranslation();
  const html = useMemo(() => chatMarkdown(text), [text]);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // the controls and the link behaviour are ours, added to the sanitized answer after it is in the page
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const copy = t('common.copy');
    for (const block of el.querySelectorAll<HTMLElement>('.md-code')) {
      const head = block.querySelector('.md-code-head');
      if (!head || head.querySelector('.md-copy')) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'md-copy';
      button.textContent = copy;
      button.setAttribute('aria-label', copy);
      head.append(button);
    }
    for (const a of el.querySelectorAll<HTMLAnchorElement>('a')) {
      if (/^(https?|mailto):/i.test(a.getAttribute('href') ?? '')) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      } else a.removeAttribute('href');
    }
  }, [html, t]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.md-copy');
    if (!button || !box.current?.contains(button)) return;
    const code = button.closest('.md-code')?.querySelector('pre code');
    if (!code) return;
    clearTimeout(timer.current);
    const done = () => {
      button.textContent = t('common.copied');
      button.classList.add('copied');
      timer.current = setTimeout(() => {
        button.textContent = t('common.copy');
        button.classList.remove('copied');
      }, 1400);
    };
    const fallback = () => {
      // no clipboard (or the page is not focused): leave the code selected so ⌘C still works
      const range = document.createRange();
      range.selectNodeContents(code);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code.textContent ?? '').then(done, fallback);
    else fallback();
  };

  return <div ref={box} className={`run-result md${bad ? ' bad' : ''}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}