import CodeBlock from '@tiptap/extension-code-block';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { parseDataFile } from '@dc/core';
import { t } from '../../i18n';

/**
 * Code blocks that draw themselves: a fence tagged latex, csv / tsv or mermaid shows its result
 * and keeps the source for when the cursor is in the block. The file stays plain Markdown (the
 * fence and its text), so Claude Code, git and every other reader see no new syntax. The libraries
 * load on first use, so a doc without such a block pays nothing.
 */
type Kind = 'math' | 'table' | 'diagram';

const KINDS: Record<string, Kind> = { latex: 'math', tex: 'math', math: 'math', csv: 'table', tsv: 'table', mermaid: 'diagram' };
const MAX_ROWS = 200;

export function kindOfFence(language: unknown): Kind | null {
  return typeof language === 'string' ? (KINDS[language.toLowerCase()] ?? null) : null;
}

const active = new PluginKey<DecorationSet>('richCodeActive');
const views = new Set<() => void>();
let counter = 0;
let queue: Promise<unknown> = Promise.resolve();

// the diagram library keeps global state, so one drawing at a time
const alone = <T>(job: () => Promise<T>): Promise<T> => {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
};

async function drawMath(into: HTMLElement, source: string): Promise<void> {
  const [{ default: katex }] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')]);
  into.innerHTML = katex.renderToString(source, { displayMode: true, throwOnError: true, trust: false });
}

async function drawTable(into: HTMLElement, source: string, language: string): Promise<void> {
  const { table } = parseDataFile(source, language.toLowerCase() === 'tsv' ? 'tsv' : 'csv');
  if (!table || !table.columns.length) throw new Error(t('docs.code.noRows'));
  const el = document.createElement('table');
  const head = el.createTHead().insertRow();
  for (const c of table.columns) head.appendChild(document.createElement('th')).textContent = c;
  const body = el.createTBody();
  for (const row of table.rows.slice(0, MAX_ROWS)) {
    const tr = body.insertRow();
    for (const c of table.columns) tr.insertCell().textContent = row[c] == null ? '' : String(row[c]);
  }
  into.replaceChildren(el);
  if (table.rows.length > MAX_ROWS) {
    const more = document.createElement('p');
    more.className = 'rc-more';
    more.textContent = t('docs.code.moreRows', { n: table.rows.length - MAX_ROWS });
    into.appendChild(more);
  }
}

async function drawDiagram(into: HTMLElement, source: string): Promise<void> {
  const { default: mermaid } = await import('mermaid');
  const svg = await alone(async () => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: document.documentElement.dataset.scheme === 'dark' ? 'dark' : 'default',
      flowchart: { htmlLabels: false },
    });
    return (await mermaid.render(`rc-${++counter}`, source)).svg;
  });
  into.innerHTML = svg;
}

export const RichCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ({ node: first, editor, getPos }) => {
      let node = first;
      let run = 0;
      let timer = 0;
      const dom = document.createElement('div');
      dom.className = 'richcode';
      const view = document.createElement('div');
      view.className = 'rc-view';
      view.contentEditable = 'false';
      // a click on the result puts the cursor in the block, which brings its source back
      view.addEventListener('click', () => {
        const pos = getPos();
        if (typeof pos === 'number') editor.chain().focus().setTextSelection(pos + 1).run();
      });
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      pre.appendChild(code);
      dom.append(view, pre);
      const language = () => String(node.attrs.language ?? '');

      const render = async () => {
        const kind = kindOfFence(language());
        dom.dataset.kind = kind ?? '';
        dom.classList.remove('rc-error');
        if (!kind) {
          view.replaceChildren();
          return;
        }
        const mine = ++run;
        const source = node.textContent;
        const into = document.createElement('div');
        try {
          if (!source.trim()) throw new Error(t('docs.code.empty'));
          if (kind === 'math') await drawMath(into, source);
          else if (kind === 'table') await drawTable(into, source, language());
          else await drawDiagram(into, source);
          if (mine === run) view.replaceChildren(...Array.from(into.childNodes));
        } catch (err) {
          if (mine !== run) return;
          dom.classList.add('rc-error');
          const msg = document.createElement('p');
          msg.className = 'rc-msg';
          msg.textContent = t('docs.code.error', { kind: t(`docs.code.kind.${kind}`), message: (err as Error).message.split('\n')[0] });
          view.replaceChildren(msg);
        }
      };
      const later = () => {
        clearTimeout(timer);
        timer = window.setTimeout(render, 250);
      };
      views.add(later);
      void render();

      return {
        dom,
        contentDOM: code,
        update(next) {
          if (next.type !== node.type) return false;
          const changed = next.textContent !== node.textContent || next.attrs.language !== node.attrs.language;
          node = next;
          if (changed) later();
          return true;
        },
        ignoreMutation: (m) => view.contains(m.target) || (m.type === 'attributes' && m.target === dom),
        destroy() {
          clearTimeout(timer);
          views.delete(later);
        },
      };
    };
  },

  addProseMirrorPlugins() {
    // the block holding the cursor shows its source; the others show only their result
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: active,
        props: {
          decorations: (state) => {
            const { $from } = state.selection;
            for (let d = $from.depth; d > 0; d--) {
              const n = $from.node(d);
              if (n.type.name === 'codeBlock') return DecorationSet.create(state.doc, [Decoration.node($from.before(d), $from.after(d), { class: 'rc-active' })]);
            }
            return DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

// a theme change redraws the diagrams in the new colours
if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
  new MutationObserver(() => views.forEach((f) => f())).observe(document.documentElement, { attributes: true, attributeFilter: ['data-scheme'] });
}
