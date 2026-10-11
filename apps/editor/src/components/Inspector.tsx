import { useState } from 'react';
import {
  attr,
  getStyle,
  hasHoleValue,
  isTextEditable,
  setPropDefault,
  type DcElement,
  type NoteEntry,
  type NoteFill,
  type PropSpec,
} from '@dc/core';
import { deleteBoard, edit, editCanvas, editElement, parsed, useCanvas, useSource, useStore } from '../store';
import { Copy, Down, Trash, Up } from './icons';

// ------------------------------------------------------------ primitives

function TextInput(props: {
  value: string;
  onCommit: (v: string) => void;
  code?: boolean;
  placeholder?: string;
  label: string;
  type?: string;
}) {
  return (
    <input
      key={props.value}
      className={`input ${props.code ? 'code' : ''}`}
      defaultValue={props.value}
      placeholder={props.placeholder}
      aria-label={props.label}
      type={props.type}
      onBlur={(e) => e.currentTarget.value !== props.value && props.onCommit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.currentTarget.value = props.value;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function toHex(v: string): string {
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + v.slice(1).replace(/./g, (c) => c + c);
  const named: Record<string, string> = { white: '#ffffff', black: '#000000', transparent: '#ffffff' };
  return named[v] ?? '#ffffff';
}

function ColorInput({ value, onCommit, label }: { value: string; onCommit: (v: string) => void; label: string }) {
  return (
    <div className="color">
      <input type="color" aria-label={label + '（取色）'} value={toHex(value)} onChange={(e) => onCommit(e.currentTarget.value)} />
      <TextInput value={value} onCommit={onCommit} code label={label} placeholder="—" />
    </div>
  );
}

// ---------------------------------------------------------------- element

interface StyleDef {
  prop: string;
  label: string;
  kind?: 'color' | 'select';
  options?: string[];
  wide?: boolean;
}

const STYLE_GROUPS: { title: string; fields: StyleDef[] }[] = [
  {
    title: '字体',
    fields: [
      { prop: 'color', label: '颜色', kind: 'color', wide: true },
      { prop: 'font-size', label: '字号' },
      { prop: 'font-weight', label: '字重', kind: 'select', options: ['', '400', '500', '600', '700', '800'] },
      { prop: 'line-height', label: '行高' },
      { prop: 'text-align', label: '对齐', kind: 'select', options: ['', 'left', 'center', 'right', 'justify'] },
    ],
  },
  {
    title: '填充与边框',
    fields: [
      { prop: 'background', label: '背景', kind: 'color', wide: true },
      { prop: 'border', label: '边框', wide: true },
      { prop: 'border-radius', label: '圆角' },
      { prop: 'opacity', label: '不透明度' },
    ],
  },
  {
    title: '尺寸与间距',
    fields: [
      { prop: 'width', label: '宽' },
      { prop: 'height', label: '高' },
      { prop: 'padding', label: '内边距' },
      { prop: 'margin', label: '外边距' },
    ],
  },
  {
    title: '布局',
    fields: [
      { prop: 'display', label: '显示', kind: 'select', options: ['', 'block', 'flex', 'grid', 'inline-flex', 'inline-block', 'none'] },
      { prop: 'flex-direction', label: '方向', kind: 'select', options: ['', 'row', 'column'] },
      { prop: 'gap', label: '间隔' },
      { prop: 'align-items', label: '交叉轴', kind: 'select', options: ['', 'flex-start', 'center', 'flex-end', 'stretch', 'baseline'] },
      { prop: 'justify-content', label: '主轴', kind: 'select', options: ['', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around'] },
    ],
  },
];

function StyleField({ def, style, onSet }: { def: StyleDef; style: string; onSet: (prop: string, v: string | null) => void }) {
  const value = getStyle(style, def.prop) ?? '';
  const hole = hasHoleValue(value);
  const commit = (v: string) => onSet(def.prop, v.trim() === '' ? null : v.trim());
  let control;
  if (hole) {
    control = <TextInput value="" placeholder="覆盖模板值" onCommit={commit} code label={def.label} />;
  } else if (def.kind === 'color') control = <ColorInput value={value} onCommit={commit} label={def.label} />;
  else if (def.kind === 'select') {
    const opts = def.options!.includes(value) ? def.options! : [...def.options!, value];
    control = (
      <select className="select" aria-label={def.label} value={value} onChange={(e) => commit(e.currentTarget.value)}>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o || '—'}
          </option>
        ))}
      </select>
    );
  } else control = <TextInput value={value} onCommit={commit} code label={def.label} placeholder="—" />;
  return (
    <label className={`field ${def.wide ? 'wide' : ''}`}>
      <span>
        {def.label} {hole && <span className="hole">{value}</span>}
      </span>
      {control}
    </label>
  );
}

function rawText(el: DcElement): string {
  return el.children.map((c) => (c.kind === 'text' ? c.text : '')).join('').trim();
}

function ElementInspector({ file, tid }: { file: string; tid: number }) {
  const source = useSource(file);
  const doc = source ? parsed(source) : null;
  const el = doc?.elements[tid];
  const [newAttr, setNewAttr] = useState({ name: '', value: '' });
  if (!doc || !el) return <div className="empty">这个元素已经不在设计里了。</div>;

  const style = attr(el, 'style') ?? '';
  const id = attr(el, 'id');
  const op = (o: Parameters<typeof editElement>[1][number]) => editElement(file, [o]);
  const setStyle = (prop: string, value: string | null) => op({ kind: 'style', tid, prop, value });
  const editable = isTextEditable(el);
  const special = el.tag.startsWith('sc-') || el.tag === 'helmet' || el.tag === 'dc-import';

  return (
    <div className="insp">
      <h2>
        &lt;{el.tag}&gt; <code>{id ? '#' + id : '#dc' + tid}</code>
      </h2>
      <div className="actions">
        {el.parent && (
          <button className="btn outline" onClick={() => useStore.setState({ selection: { kind: 'el', file, tid: el.parent!.tid } })}>
            选中父级
          </button>
        )}
        <button className="btn outline" onClick={() => op({ kind: 'duplicate', tid })} title="复制（⌘D）" aria-label="复制">
          <Copy />
        </button>
        <button className="btn outline" onClick={() => op({ kind: 'move', tid, dir: -1 })} title="前移" aria-label="前移">
          <Up />
        </button>
        <button className="btn outline" onClick={() => op({ kind: 'move', tid, dir: 1 })} title="后移" aria-label="后移">
          <Down />
        </button>
        <button
          className="btn outline danger"
          onClick={() => {
            op({ kind: 'remove', tid });
            useStore.setState({ selection: { kind: 'board', file } });
          }}
          title="删除（Delete）"
          aria-label="删除"
        >
          <Trash />
        </button>
      </div>

      {special && (
        <p className="hint">
          {el.tag === 'sc-for'
            ? '这是循环：里面的内容按数据重复渲染，改一处会改到每一项。数据来自画板的脚本。'
            : el.tag === 'sc-if'
              ? '这是条件块：是否显示由画板脚本里的值决定。'
              : el.tag === 'helmet'
                ? '页面级样式和字体。'
                : '引用的子组件，内部请到它自己的画板里改。'}
        </p>
      )}

      {editable && (
        <section>
          <h3>文字</h3>
          <textarea
            key={rawText(el)}
            className="textarea"
            aria-label="文字内容"
            defaultValue={rawText(el)}
            onBlur={(e) => e.currentTarget.value !== rawText(el) && op({ kind: 'text', tid, text: e.currentTarget.value })}
          />
          <span className="hint">也可以在画板上双击直接改。</span>
        </section>
      )}

      {!special &&
        STYLE_GROUPS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <div className="fields">
              {g.fields.map((f) => (
                <StyleField key={f.prop} def={f} style={style} onSet={setStyle} />
              ))}
            </div>
          </section>
        ))}

      {!special && (
        <section>
          <h3>内联样式</h3>
          <textarea
            key={style}
            className="textarea code"
            aria-label="内联样式"
            defaultValue={style}
            onBlur={(e) => e.currentTarget.value !== style && op({ kind: 'styleText', tid, text: e.currentTarget.value })}
          />
          <span className="hint">带 {'{{…}}'} 的声明来自模板，保持原样；在它后面写同名属性会覆盖它。</span>
        </section>
      )}

      <section>
        <h3>属性</h3>
        <div className="fields">
          {el.attrs
            .filter((a) => a.name !== 'style')
            .map((a) => (
              <label className="field wide" key={a.name}>
                <span>{a.name}</span>
                <TextInput
                  value={a.value}
                  code
                  label={a.name}
                  onCommit={(v) => op({ kind: 'attr', tid, name: a.name, value: v === '' && !['alt', 'value'].includes(a.name) ? null : v })}
                />
              </label>
            ))}
          <form
            className="field wide"
            onSubmit={(e) => {
              e.preventDefault();
              if (!/^[A-Za-z_][\w:.-]*$/.test(newAttr.name)) return;
              op({ kind: 'attr', tid, name: newAttr.name, value: newAttr.value });
              setNewAttr({ name: '', value: '' });
            }}
          >
            <span>添加属性</span>
            <div className="color">
              <input className="input code" placeholder="名称" aria-label="属性名" value={newAttr.name} onChange={(e) => setNewAttr({ ...newAttr, name: e.target.value })} />
              <input className="input code" placeholder="值" aria-label="属性值" value={newAttr.value} onChange={(e) => setNewAttr({ ...newAttr, value: e.target.value })} />
              <button className="btn outline" type="submit">
                添加
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- board

function TweakField({ file, name, spec }: { file: string; name: string; spec: PropSpec }) {
  const set = (value: unknown) =>
    edit(file, (src) => setPropDefault(src, name, value).source, { actor: 'human', summary: `tweak ${name} → ${JSON.stringify(value)}` });
  const v = spec.default;
  let control;
  switch (spec.editor) {
    case 'color':
      control = (
        <>
          {Array.isArray(spec.options) && (
            <div className="swatches">
              {(spec.options as string[]).map((o) => (
                <button key={o} style={{ background: o }} aria-label={o} aria-pressed={o === v} onClick={() => set(o)} />
              ))}
            </div>
          )}
          <ColorInput value={String(v ?? '')} onCommit={set} label={name} />
        </>
      );
      break;
    case 'enum':
      control = (
        <select className="select" aria-label={name} value={String(v)} onChange={(e) => set(e.currentTarget.value)}>
          {(spec.options ?? []).map((o) => (
            <option key={String(o)} value={String(o)}>
              {String(o)}
            </option>
          ))}
        </select>
      );
      break;
    case 'boolean':
      control = (
        <label className="check">
          <input type="checkbox" checked={Boolean(v)} onChange={(e) => set(e.currentTarget.checked)} /> {v ? '开' : '关'}
        </label>
      );
      break;
    case 'int':
    case 'float':
    case 'range':
      control = (
        <div className="color">
          {spec.editor === 'range' && (
            <input
              type="range"
              min={spec.min ?? 0}
              max={spec.max ?? 100}
              step={spec.step ?? 1}
              defaultValue={Number(v ?? 0)}
              key={String(v)}
              aria-label={name}
              onPointerUp={(e) => set(Number(e.currentTarget.value))}
              style={{ flex: 1 }}
            />
          )}
          <TextInput value={String(v ?? '')} label={name} code onCommit={(s) => set(spec.editor === 'int' ? parseInt(s, 10) : parseFloat(s))} />
        </div>
      );
      break;
    default:
      control = <TextInput value={String(v ?? '')} label={name} onCommit={set} />;
  }
  return (
    <div className="field wide">
      <span>
        {name}
        {spec.unit ? `（${spec.unit}）` : ''}
      </span>
      {control}
    </div>
  );
}

function BoardInspector({ file }: { file: string }) {
  const canvas = useCanvas();
  const b = canvas.boards[file];
  const source = useSource(file);
  const doc = source ? parsed(source) : null;
  const error = useStore((s) => s.runtimeErrors[file]);
  if (!b) return null;
  const setB = (k: 'x' | 'y' | 'w' | 'h' | 'title', v: string) =>
    editCanvas((c) => {
      const t = c.boards[file];
      if (!t) return;
      if (k === 'title') t.title = v || undefined;
      else if (Number.isFinite(Number(v))) t[k] = Math.round(Number(v));
    }, `artboard ${file} ${k} → ${v}`);
  const tweaks = Object.entries(doc?.props ?? {}).filter(([k, s]) => !k.startsWith('$') && s && s.editor);

  return (
    <div className="insp">
      <h2>
        画板 <code>{file}</code>
      </h2>
      {error && <p className="hint" style={{ color: 'var(--danger)', whiteSpace: 'pre-wrap' }}>{error}</p>}
      <section>
        <div className="fields">
          <label className="field wide">
            <span>名称</span>
            <TextInput value={b.title ?? ''} onCommit={(v) => setB('title', v)} label="画板名称" />
          </label>
          {(['x', 'y', 'w', 'h'] as const).map((k) => (
            <label className="field" key={k}>
              <span>{{ x: 'X', y: 'Y', w: '宽', h: '高' }[k]}</span>
              <TextInput value={String(b[k])} onCommit={(v) => setB(k, v)} code label={k} />
            </label>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(b.is_interactive)}
            onChange={(e) => {
              const on = e.currentTarget.checked;
              editCanvas((c) => {
                if (!c.boards[file]) return;
                if (on) c.boards[file].is_interactive = true;
                else delete c.boards[file].is_interactive;
              }, `artboard ${file} interactive ${on}`);
            }}
          />
          可交互（播放模式下按钮可点）
        </label>
      </section>
      <section>
        <h3>Tweaks</h3>
        {tweaks.length ? (
          tweaks.map(([k, s]) => <TweakField key={k} file={file} name={k} spec={s} />)
        ) : (
          <span className="hint">这个画板没有声明可调参数（data-props）。</span>
        )}
      </section>
      <section>
        <button
          className="btn outline danger"
          onClick={() => confirm(`删除画板 ${file}？文件也会被删除（可以用 git 找回）。`) && void deleteBoard(file)}
        >
          <Trash /> 删除画板
        </button>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- note

const FILLS: NoteFill[] = ['gray', 'red', 'orange', 'green', 'teal', 'blue', 'purple', 'pink'];

function NoteInspector({ id }: { id: string }) {
  const canvas = useCanvas();
  const n = canvas.notes[id];
  if (!n) return null;
  const setN = (fn: (n: NoteEntry) => void, what: string) => editCanvas((c) => void (c.notes[id] && fn(c.notes[id])), `note ${id} ${what}`);
  const title = n.kind === 'title1';
  return (
    <div className="insp">
      <h2>{title ? '标题' : '便签'}</h2>
      <section>
        <textarea
          key={n.text}
          className="textarea"
          style={{ minHeight: 140 }}
          aria-label="内容"
          defaultValue={n.text}
          onBlur={(e) => e.currentTarget.value !== n.text && setN((x) => (x.text = e.currentTarget.value), 'text')}
        />
      </section>
      {!title && (
        <section>
          <h3>颜色</h3>
          <div className="swatches">
            {FILLS.map((f) => (
              <button
                key={f}
                style={{ background: `var(--note-${f})` }}
                aria-label={f}
                aria-pressed={(n.fill ?? 'orange') === f}
                onClick={() => setN((x) => (x.fill = f), `fill ${f}`)}
              />
            ))}
          </div>
          <div className="fields">
            <label className="field">
              <span>宽</span>
              <TextInput value={String(n.w ?? 320)} code label="宽" onCommit={(v) => setN((x) => (x.w = Math.max(80, Number(v) || 320)), 'width')} />
            </label>
            <label className="field">
              <span>字号</span>
              <TextInput value={String(n.size ?? '')} code label="字号" onCommit={(v) => setN((x) => (x.size = Number(v) || undefined), 'size')} />
            </label>
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- root

export function Inspector() {
  const sel = useStore((s) => s.selection);
  const canvas = useCanvas();
  if (sel?.kind === 'el') return <ElementInspector key={sel.file + sel.tid} file={sel.file} tid={sel.tid} />;
  if (sel?.kind === 'board') return <BoardInspector file={sel.file} />;
  if (sel?.kind === 'note') return <NoteInspector id={sel.id} />;
  return (
    <div className="insp">
      <section>
        <label className="field wide">
          <span>画布名称</span>
          <TextInput value={canvas.title} label="画布名称" onCommit={(v) => editCanvas((c) => (c.title = v || c.title), `title → ${v}`)} />
        </label>
      </section>
      <section>
        <h3>怎么用</h3>
        <p className="hint" style={{ margin: 0, lineHeight: 1.7 }}>
          点选元素后在这里改样式；双击画板里的文字直接改字；拖动画板名称移动画板。
          <br />
          底部输入框：快速 AI 逐行改当前画板，Claude Code 适合改脚本、数据和跨画板的事，jQuery 可以手写语句。
          <br />
          <span className="kbd">V</span> 选择 · <span className="kbd">H</span> 抓手 · <span className="kbd">P</span> 播放 · <span className="kbd">0</span> 适应窗口 ·{' '}
          <span className="kbd">⌘Z</span> 撤销
        </p>
      </section>
    </div>
  );
}
