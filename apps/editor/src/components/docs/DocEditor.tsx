import { useEffect, useMemo, useRef, useState } from 'react';
import { IconBold, IconCode, IconExternalLink, IconHighlight, IconItalic, IconStrikethrough, IconTypography, IconX } from '@tabler/icons-react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import { DOC_COLOR_NAMES, docsUserMessage, quoteAt, tabFile } from '@dc/core';
import { api } from '../../api';
import { display, openPane, toast, useStore } from '../../store';
import { dateLocale, saveTab, useComments, useDocs, threadsOf } from './docs';
import { useTranslation } from 'react-i18next';
import { t as tModule } from '../../i18n';
import { CommentMarks, commentsKey, docText } from './docText';
import { RichCodeBlock } from './richCode';
import { TextColor } from './textColor';

/** The editor of the open tab, for the toolbar and the outline. */
export const docEditor: { current: Editor | null } = { current: null };

/** Opens the link the selection is in; visible only while a link is, so it subscribes itself (the editor does not re-render on selection moves). */
function OpenLink({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    editor.on('transaction', f);
    return () => {
      editor.off('transaction', f);
    };
  }, [editor]);
  if (!editor.isActive('link')) return null;
  return (
    <button
      aria-label={t('docs.format.openLink')}
      title={t('docs.format.openLink')}
      onClick={() => {
        const href = editor.getAttributes('link').href;
        if (href) window.open(String(href), '_blank', 'noopener,noreferrer');
      }}
    >
      <IconExternalLink size={16} stroke={1.7} aria-hidden="true" />
    </button>
  );
}

/** Colours the selected words from the doc's palette (names, drawn with theme tokens); subscribes itself like `OpenLink`. */
function TextColorPicker({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  useEffect(() => {
    const f = ({ transaction }: { transaction: { selectionSet: boolean } }) => {
      if (transaction.selectionSet) setOpen(false);
      force((n) => n + 1);
    };
    editor.on('transaction', f);
    return () => {
      editor.off('transaction', f);
    };
  }, [editor]);
  const { from, to } = editor.state.selection;
  const anyColor = editor.state.doc.rangeHasMark(from, to, editor.schema.marks.textColor);
  const current = editor.isActive('textColor') ? (editor.getAttributes('textColor').color as string) : null;
  return (
    <>
      <button className={open || anyColor ? 'on' : ''} aria-expanded={open} aria-label={t('docs.format.color')} title={t('docs.format.color')} onClick={() => setOpen(!open)}>
        <IconTypography size={16} stroke={1.7} aria-hidden="true" />
        <span className="swatchbar" data-color={current ?? undefined} />
      </button>
      {open && (
        <span className="swatches" role="group" aria-label={t('docs.format.color')}>
          {DOC_COLOR_NAMES.map((c) => (
            <button
              key={c}
              className={`swatch${current === c ? ' on' : ''}`}
              data-color={c}
              aria-label={t(`docs.color.${c}`)}
              title={t(`docs.color.${c}`)}
              onClick={() => {
                if (current === c) editor.chain().focus().unsetTextColor().run();
                else editor.chain().focus().setTextColor(c).run();
                setOpen(false);
              }}
            />
          ))}
          <button
            aria-label={t('docs.color.clear')}
            title={t('docs.color.clear')}
            disabled={!anyColor}
            onClick={() => {
              editor.chain().focus().unsetTextColor().run();
              setOpen(false);
            }}
          >
            <IconX size={14} stroke={1.7} aria-hidden="true" />
          </button>
        </span>
      )}
    </>
  );
}

type BlockKey = 'p' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'todo' | 'quote' | 'code' | 'diagram' | 'formula' | 'table' | 'hr' | 'date' | 'image';

interface SlashItem {
  key: BlockKey;
  hint: string;
  run: (e: Editor) => void;
}

const SLASH: SlashItem[] = [
  { key: 'p', hint: 'text paragraph', run: (e) => e.chain().focus().setParagraph().run() },
  { key: 'h1', hint: 'heading h1', run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { key: 'h2', hint: 'heading h2', run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { key: 'h3', hint: 'heading h3', run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { key: 'ul', hint: 'bullet list', run: (e) => e.chain().focus().toggleBulletList().run() },
  { key: 'ol', hint: 'numbered ordered list', run: (e) => e.chain().focus().toggleOrderedList().run() },
  { key: 'todo', hint: 'task checklist todo', run: (e) => e.chain().focus().toggleTaskList().run() },
  { key: 'quote', hint: 'quote blockquote', run: (e) => e.chain().focus().toggleBlockquote().run() },
  { key: 'code', hint: 'code block', run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { key: 'diagram', hint: 'diagram mermaid flowchart', run: (e) => fence(e, 'mermaid', 'flowchart LR\n  Idea --> Draft --> Ship') },
  { key: 'formula', hint: 'formula math latex equation', run: (e) => fence(e, 'latex', 'E = mc^2') },
  { key: 'table', hint: 'table', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { key: 'hr', hint: 'divider rule hr', run: (e) => e.chain().focus().setHorizontalRule().run() },
  { key: 'date', hint: 'date today', run: (e) => e.chain().focus().insertContent(new Date().toLocaleDateString(dateLocale(), { year: 'numeric', month: 'long', day: 'numeric' })).run() },
  { key: 'image', hint: 'image picture upload', run: (e) => pickImage(e) },
];

/** A code block with a language and a starting text, selected so typing replaces it. */
function fence(e: Editor, language: string, text: string): void {
  e.chain().focus().insertContent({ type: 'codeBlock', attrs: { language }, content: [{ type: 'text', text }] }).run();
  const end = e.state.selection.to;
  e.commands.setTextSelection({ from: end - text.length, to: end });
}

export function pickImage(e: Editor): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const f = input.files?.[0];
    const project = useStore.getState().project;
    if (!f || !project) return;
    try {
      const up = await api.upload(project, f, 'uploads');
      // the tab file is tabs/<id>.md: images are written relative to it
      e.chain().focus().setImage({ src: '../' + up.path, alt: f.name.replace(/\.[^.]*$/, '') }).run();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  input.click();
}

/** Show images written relative to the tab file from the project's raw files. */
function imageSrc(src: string): string {
  const project = useStore.getState().project;
  if (!project || /^(https?:|data:|blob:)/.test(src)) return src;
  return api.rawBase(project) + src.replace(/^\.\.\//, '').replace(/^\.\//, 'tabs/');
}

const ProjectImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    return ['img', { ...HTMLAttributes, src: imageSrc(String(HTMLAttributes.src ?? '')), 'data-src': HTMLAttributes.src }];
  },
});

/** The top-level blocks a selection touches, as positions. */
function blockRange(e: Editor): { from: number; to: number } {
  const { $from, $to } = e.state.selection;
  const from = $from.depth >= 1 ? $from.before(1) : $from.pos;
  const to = $to.depth >= 1 ? $to.after(1) : $to.pos;
  return { from, to };
}

function sliceMarkdown(e: Editor, from: number, to: number): string {
  const json = { type: 'doc', content: e.state.doc.slice(from, to).content.toJSON() ?? [] };
  return e.markdown?.serialize(json) ?? '';
}

interface Spark {
  from: number;
  to: number;
  request: string;
  text: string;
  state: 'running' | 'done' | 'error';
  error?: string;
}

const SPARKS = [
  ['shorter', 'Make it shorter: keep every point, cut the words.'],
  ['polish', 'Fix spelling, grammar and awkward phrasing. Change nothing else.'],
  ['formal', 'Make it more formal.'],
] as const;

export function DocEditor({ tab }: { tab: string }) {
  const { t } = useTranslation();
  const file = tabFile(tab);
  const source = useStore((s) => display(s, file));
  const comments = useComments();
  const thread = useDocs((s) => s.thread);
  const showResolved = useDocs((s) => s.showResolved);
  const threads = useMemo(() => threadsOf(comments, tab, showResolved), [comments, tab, showResolved]);
  /** the Markdown the editor's content was loaded from or last saved as */
  const synced = useRef<string | null>(null);
  const timer = useRef(0);
  const nextActor = useRef<'human' | 'fast-edit'>('human');
  const [slash, setSlash] = useState<{ query: string; x: number; y: number; index: number } | null>(null);
  const [spark, setSpark] = useState<Spark | null>(null);
  const [ask, setAsk] = useState('');
  const abort = useRef<AbortController | null>(null);

  const flush = (e: Editor | null) => {
    clearTimeout(timer.current);
    timer.current = 0;
    if (!e || e.isDestroyed) return;
    const md = e.getMarkdown();
    const actor = nextActor.current;
    nextActor.current = 'human';
    synced.current = saveTab(tab, md, actor, actor === 'fast-edit' ? `${file}: rewritten by the writing model` : undefined);
  };

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ link: { openOnClick: false, autolink: true }, codeBlock: false }),
        RichCodeBlock,
        TaskList,
        TaskItem.configure({ nested: true }),
        TableKit.configure({ table: { resizable: false } }),
        Highlight,
        TextColor,
        ProjectImage,
        Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? tModule('docs.editor.headingPlaceholder') : tModule('docs.editor.placeholder')) }),
        Markdown.configure({ markedOptions: { gfm: true } }),
        CommentMarks,
      ],
      editorProps: {
        attributes: { class: 'docbody', spellcheck: 'false' },
        handleKeyDown: (_view, ev) => {
          if (!slashRef.current) return false;
          const list = matches(slashRef.current.query);
          if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
            setSlash((s) => (s ? { ...s, index: (s.index + (ev.key === 'ArrowDown' ? 1 : list.length - 1)) % Math.max(1, list.length) } : s));
            return true;
          }
          if (ev.key === 'Enter' && list.length) {
            choose(list[slashRef.current.index % list.length]);
            return true;
          }
          if (ev.key === 'Escape') {
            setSlash(null);
            return true;
          }
          return false;
        },
        handleClick: (_view, _pos, ev) => {
          const el = ev.target as HTMLElement;
          // ⌘-click / Ctrl-click opens the link; a plain click keeps placing the cursor for editing
          if ((ev.metaKey || ev.ctrlKey) && ev.button === 0) {
            const a = el.closest?.('a');
            if (a?.href) {
              window.open(a.href, '_blank', 'noopener,noreferrer');
              return true;
            }
          }
          const id = el.closest?.('[data-thread]')?.getAttribute('data-thread');
          if (id) (useDocs.setState({ thread: id }), openPane('comments'));
          return false;
        },
      },
      onUpdate: ({ editor: e, transaction }) => {
        if (transaction.getMeta('dc-load')) return;
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => flush(e), 450);
        updateSlash(e);
      },
      onSelectionUpdate: ({ editor: e }) => updateSlash(e),
      onBlur: ({ editor: e }) => {
        if (timer.current) flush(e);
      },
    },
    [],
  );

  const slashRef = useRef(slash);
  slashRef.current = slash;

  function matches(q: string): SlashItem[] {
    const s = q.trim().toLowerCase();
    return s ? SLASH.filter((i) => tModule(`docs.block.${i.key}`).toLowerCase().includes(s) || i.hint.includes(s) || i.key.startsWith(s)) : SLASH;
  }

  function updateSlash(e: Editor) {
    const { $from, empty } = e.state.selection;
    const text = $from.parent.textContent;
    if (!empty || $from.parent.type.name !== 'paragraph' || !text.startsWith('/') || $from.parentOffset !== text.length || text.length > 20) {
      if (slashRef.current) setSlash(null);
      return;
    }
    const c = e.view.coordsAtPos($from.pos);
    setSlash((s) => ({ query: text.slice(1), x: c.left, y: c.bottom + 6, index: s?.index ?? 0 }));
  }

  function choose(item: SlashItem) {
    const e = editor;
    if (!e) return;
    const { $from } = e.state.selection;
    e.chain().focus().deleteRange({ from: $from.start(), to: $from.pos }).run();
    setSlash(null);
    item.run(e);
  }

  // load the tab, and take in what others wrote
  useEffect(() => {
    const e = editor;
    if (!e || source === undefined) return;
    if (source === synced.current) return;
    if (timer.current) {
      // my unsaved words go in first (replayed onto theirs), then the result loads
      flush(e);
      return;
    }
    const focused = e.isFocused;
    const t = docText(e.state.doc);
    const sel = { from: t.offsetAt(e.state.selection.from), to: t.offsetAt(e.state.selection.to) };
    e.chain()
      .setMeta('dc-load', true)
      .setMeta('addToHistory', synced.current !== null ? true : false)
      .setContent(source, { contentType: 'markdown', emitUpdate: false })
      .run();
    synced.current = source;
    if (focused) {
      const n = docText(e.state.doc);
      const size = e.state.doc.content.size;
      e.commands.setTextSelection({ from: Math.min(n.posAt(sel.from), size), to: Math.min(n.posAt(sel.to), size) });
    }
    // comments may need placing again
    e.view.dispatch(e.state.tr.setMeta(commentsKey, { threads, active: thread }).setMeta('addToHistory', false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, source]);

  useEffect(() => {
    const e = editor;
    if (!e || e.isDestroyed) return;
    e.view.dispatch(e.state.tr.setMeta(commentsKey, { threads, active: thread }).setMeta('addToHistory', false));
  }, [editor, threads, thread]);

  useEffect(() => {
    docEditor.current = editor;
    return () => {
      if (timer.current) flush(editor);
      if (docEditor.current === editor) docEditor.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // the lit thread scrolls into view
  useEffect(() => {
    if (!thread) return;
    const el = document.querySelector(`.docbody [data-thread="${CSS.escape(thread)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [thread]);

  const comment = () => {
    const e = editor;
    if (!e) return;
    const t = docText(e.state.doc);
    const from = t.offsetAt(e.state.selection.from);
    const to = t.offsetAt(e.state.selection.to);
    if (to <= from) return;
    useDocs.setState({ draft: quoteAt(t.text, from, to), thread: null });
    openPane('comments');
  };

  const runSpark = async (request: string) => {
    const e = editor;
    const project = useStore.getState().project;
    if (!e || !project) return;
    if (timer.current) flush(e);
    const { from, to } = blockRange(e);
    const passage = sliceMarkdown(e, from, to);
    const before = sliceMarkdown(e, 0, from);
    const after = sliceMarkdown(e, to, e.state.doc.content.size);
    setSpark({ from, to, request, text: '', state: 'running' });
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    try {
      const res = await api.fastEdit(project, [{ role: 'user', content: docsUserMessage({ before, passage, after, request }) }], ac.signal, 'docs');
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let text = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        const err = /\n__ERROR__ (.*)\n?$/.exec(text);
        if (err) throw new Error(err[1]);
        setSpark((s) => (s ? { ...s, text } : s));
      }
      setSpark((s) => (s ? { ...s, text: text.replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/, '$1'), state: 'done' } : s));
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setSpark((s) => (s ? { ...s, state: 'error', error: (err as Error).message } : s));
    }
  };

  const applySpark = (mode: 'replace' | 'below') => {
    const e = editor;
    if (!e || !spark) return;
    nextActor.current = 'fast-edit';
    const range = mode === 'replace' ? { from: spark.from, to: Math.min(spark.to, e.state.doc.content.size) } : spark.to;
    e.chain().focus().insertContentAt(range, spark.text.trim() + '\n', { contentType: 'markdown' }).run();
    flush(e);
    setSpark(null);
  };

  if (!editor) return null;
  const list = slash ? matches(slash.query) : [];
  return (
    <>
      <BubbleMenu editor={editor} options={{ placement: 'top' }} shouldShow={({ editor: e, state }) => !state.selection.empty && e.isEditable && !e.isActive('codeBlock')}>
        <div className="bubble" role="toolbar" aria-label={t('docs.format.label')}>
          <button className={editor.isActive('bold') ? 'on' : ''} onClick={() => editor.chain().focus().toggleBold().run()} aria-label={t('docs.format.bold')}>
            <IconBold size={16} stroke={1.7} aria-hidden="true" />
          </button>
          <button className={editor.isActive('italic') ? 'on' : ''} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label={t('docs.format.italic')}>
            <IconItalic size={16} stroke={1.7} aria-hidden="true" />
          </button>
          <button className={editor.isActive('strike') ? 'on' : ''} onClick={() => editor.chain().focus().toggleStrike().run()} aria-label={t('docs.format.strike')}>
            <IconStrikethrough size={16} stroke={1.7} aria-hidden="true" />
          </button>
          <button className={editor.isActive('code') ? 'on' : ''} onClick={() => editor.chain().focus().toggleCode().run()} aria-label={t('docs.format.inlineCode')}>
            <IconCode size={16} stroke={1.7} aria-hidden="true" />
          </button>
          <button className={editor.isActive('highlight') ? 'on' : ''} onClick={() => editor.chain().focus().toggleHighlight().run()} aria-label={t('docs.format.highlight')}>
            <IconHighlight size={16} stroke={1.7} aria-hidden="true" />
          </button>
          <TextColorPicker editor={editor} />
          <OpenLink editor={editor} />
          <button
            className={editor.isActive('link') ? 'on' : ''}
            aria-label={t('docs.format.link')}
            onClick={() => {
              if (editor.isActive('link')) return void editor.chain().focus().unsetLink().run();
              const href = prompt(t('docs.format.linkPrompt'), 'https://');
              if (href && /^(https?:|mailto:|\/|#|\.)/.test(href)) editor.chain().focus().setLink({ href }).run();
            }}
          >
            {t('docs.format.link')}
          </button>
          <span className="sep" />
          <button onClick={comment} aria-label={t('docs.format.comment')}>
            {t('docs.format.comment')}
          </button>
          <span className="sep" />
          {SPARKS.map(([key, req]) => (
            <button key={key} className="spark" onClick={() => void runSpark(req)}>
              ✦ {t(`docs.spark.${key}`)}
            </button>
          ))}
          <input
            className="askin"
            placeholder={t('docs.spark.askPlaceholder')}
            aria-label={t('docs.spark.askLabel')}
            value={ask}
            onChange={(ev) => setAsk(ev.target.value)}
            onKeyDown={(ev) => {
              ev.stopPropagation();
              if (ev.key === 'Enter' && ask.trim() && !ev.nativeEvent.isComposing) {
                void runSpark(ask.trim());
                setAsk('');
              }
            }}
          />
        </div>
      </BubbleMenu>
      <EditorContent editor={editor} />
      {slash && list.length > 0 && (
        <div className="slashmenu" role="listbox" aria-label={t('docs.editor.slashLabel')} style={{ left: slash.x, top: slash.y }}>
          {list.map((i, n) => (
            <button
              key={i.key}
              role="option"
              aria-selected={n === slash.index % list.length}
              onMouseDown={(ev) => {
                ev.preventDefault();
                choose(i);
              }}
            >
              {t(`docs.block.${i.key}`)}
            </button>
          ))}
        </div>
      )}
      {spark && (
        <div className="sparkpanel" role="dialog" aria-label={t('docs.spark.panelLabel')}>
          <div className="hint">
            ✦{' '}
            {t('docs.spark.status', {
              status: spark.state === 'running' ? t('docs.spark.running') : spark.state === 'error' ? t('docs.spark.failed', { error: spark.error }) : t('docs.spark.done'),
              request: ((k) => (k ? t(`docs.spark.${k}`) : spark.request))(SPARKS.find((s) => s[1] === spark.request)?.[0]),
            })}
          </div>
          {spark.text && <pre className="sparktext">{spark.text}</pre>}
          <div className="row">
            <button
              className="btn ghost"
              onClick={() => {
                abort.current?.abort();
                setSpark(null);
              }}
            >
              {t('docs.spark.discard')}
            </button>
            <button className="btn ghost" disabled={spark.state !== 'done'} onClick={() => applySpark('below')}>
              {t('docs.spark.insertBelow')}
            </button>
            <button className="btn primary" disabled={spark.state !== 'done'} onClick={() => applySpark('replace')}>
              {t('docs.spark.replace')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
