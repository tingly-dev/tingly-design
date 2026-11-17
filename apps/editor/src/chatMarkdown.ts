import { Marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';

/**
 * An answer from the AI, as HTML: GitHub-flavoured Markdown, then sanitized. A fenced block
 * becomes a frame with a language label and its own `<pre>` (the copy button is added by
 * `ChatMarkdown` after it is in the page, so no control comes from the answer's own HTML), and
 * a picture is never a picture: a remote image would be a request nobody asked for, so its alt
 * text (or the file's name) stands in. Single newlines stay line breaks (`breaks`), because a
 * plain answer used to be shown with `white-space: pre-wrap` and must look unchanged.
 * See .design/conversation-markdown.md.
 */

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const md = new Marked({ gfm: true, breaks: true, async: false });
md.use({
  renderer: {
    code(token: Tokens.Code) {
      const lang = (token.lang ?? '').trim().split(/\s+/)[0].replace(/[^a-z0-9+#.-]/gi, '');
      const body = token.escaped ? token.text : escapeHtml(token.text);
      const name = lang ? `<span>${escapeHtml(lang)}</span>` : '<span></span>';
      return `<div class="md-code"><div class="md-code-head">${name}</div><pre><code${lang ? ` class="language-${lang}"` : ''}>${body}</code></pre></div>`;
    },
    image(token: Tokens.Image) {
      const name = token.text || token.href.split('/').filter(Boolean).pop() || token.href;
      return `<span class="md-image" title="${escapeHtml(token.href)}">${escapeHtml(name)}</span>`;
    },
  },
});

export function chatMarkdown(text: string): string {
  const html = md.parse(text) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'img', 'picture', 'source', 'svg', 'math', 'iframe', 'object', 'embed', 'video', 'audio', 'track', 'link', 'meta', 'base'],
    FORBID_ATTR: ['style'],
    ADD_ATTR: ['target', 'rel'],
  });
}