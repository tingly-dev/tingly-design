import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findQuote, type DocThread } from '@dc/core';

/**
 * A tab's text as one string (text blocks joined by newlines), with the
 * way back and forth to document positions: comments anchor to words in it,
 * and a selection survives a reload through it.
 */
export interface DocText {
  text: string;
  offsetAt(pos: number): number;
  posAt(offset: number): number;
}

export function docText(doc: PMNode): DocText {
  const segs: { off: number; pos: number; len: number }[] = [];
  let text = '';
  let first = true;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (!first) text += '\n';
      first = false;
    }
    if (node.isText) {
      segs.push({ off: text.length, pos, len: node.text!.length });
      text += node.text;
    }
    return true;
  });
  return {
    text,
    offsetAt(pos) {
      let best = 0;
      for (const s of segs) {
        if (pos < s.pos) break;
        best = s.off + Math.min(pos - s.pos, s.len);
      }
      return best;
    },
    posAt(off) {
      let best = segs.length ? segs[0].pos : 1;
      for (const s of segs) {
        if (off < s.off) break;
        best = s.pos + Math.min(off - s.off, s.len);
      }
      return best;
    },
  };
}

interface CommentsState {
  threads: DocThread[];
  active: string | null;
  deco: DecorationSet;
}

export const commentsKey = new PluginKey<CommentsState>('dc-comments');

function decorate(doc: PMNode, threads: DocThread[], active: string | null): DecorationSet {
  if (!threads.length) return DecorationSet.empty;
  const t = docText(doc);
  const out: Decoration[] = [];
  for (const th of threads) {
    const at = findQuote(t.text, th);
    if (!at) continue;
    const from = t.posAt(at.from);
    const to = t.posAt(at.to);
    if (to <= from) continue;
    out.push(Decoration.inline(from, to, { class: `cmark${th.id === active ? ' on' : ''}${th.resolved ? ' done' : ''}`, 'data-thread': th.id }));
  }
  return DecorationSet.create(doc, out);
}

/** Highlights the words each comment thread is pinned to. Fed threads through a transaction's meta. */
export const CommentMarks = Extension.create({
  name: 'dcComments',
  addProseMirrorPlugins() {
    return [
      new Plugin<CommentsState>({
        key: commentsKey,
        state: {
          init: (): CommentsState => ({ threads: [], active: null, deco: DecorationSet.empty }),
          apply(tr, value) {
            const meta = tr.getMeta(commentsKey) as { threads: DocThread[]; active: string | null } | undefined;
            if (meta) return { ...meta, deco: decorate(tr.doc, meta.threads, meta.active) };
            if (tr.docChanged) return { ...value, deco: decorate(tr.doc, value.threads, value.active) };
            return value;
          },
        },
        props: {
          decorations(state) {
            return commentsKey.getState(state)?.deco ?? null;
          },
        },
      }),
    ];
  },
});
