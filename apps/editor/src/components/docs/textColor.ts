import { Mark, mergeAttributes } from '@tiptap/core';
import { DOC_COLOR_NAMES, isDocColor } from '@dc/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: string) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
  }
}

const SPAN = new RegExp(`^<span data-color="(${DOC_COLOR_NAMES.join('|')})">([\\s\\S]*?)</span>`);

/** Coloured words. In the Markdown file they are `<span data-color="red">…</span>` (names, not hex: `docColors.ts`); the editor draws the name with a theme token. */
export const TextColor = Mark.create({
  name: 'textColor',
  addAttributes() {
    return { color: { default: null, parseHTML: (el) => el.getAttribute('data-color'), renderHTML: (a) => (isDocColor(a.color) ? { 'data-color': a.color } : {}) } };
  },
  parseHTML() {
    return [{ tag: 'span[data-color]', getAttrs: (el) => (isDocColor((el as HTMLElement).getAttribute('data-color')) ? null : false) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },
  renderMarkdown: (node, h) => `<span data-color="${node.attrs?.color}">${h.renderChildren(node)}</span>`,
  parseMarkdown: (token, h) => h.applyMark('textColor', h.parseInline(token.tokens || []), { color: token.color }),
  markdownTokenizer: {
    name: 'textColor',
    level: 'inline',
    start: (src: string) => src.indexOf('<span data-color='),
    tokenize(src, _, h) {
      const m = SPAN.exec(src);
      if (!m) return undefined;
      return { type: 'textColor', raw: m[0], color: m[1], text: m[2], tokens: h.inlineTokens(m[2]) };
    },
  },
  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          isDocColor(color) && commands.setMark(this.name, { color }),
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
