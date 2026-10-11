import type React from 'react';
import { NOTE_SIZES, setPropDefault, type BoardEntry, type DcDoc, type NoteEntry, type NoteFill, type PropSpec } from '@dc/core';
import { duplicateBoard, updateBoard, updateNote } from '../../actions';
import { deleteBoard, display, edit, useStore } from '../../store';
import { TEXT_COLORS, sizeOf } from '../Item';
import { ColorField, Field, Row, Seg, Select, px, toLength } from './fields';

// ---------------------------------------------------------------- artboard

export function BoardProps({ file, entry }: { file: string; entry: BoardEntry }) {
  const n = (v: string) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : undefined);
  return (
    <>
      <div className="sec">
        <h3>画板</h3>
        <Row label="名称">
          <Field value={entry.title ?? ''} placeholder={file} numeric={false} onCommit={(v) => updateBoard(file, { title: v.trim() || undefined }, 'renamed')} label="画板名称" />
        </Row>
        <Row label="位置">
          <Field value={String(entry.x)} onCommit={(v) => n(v) !== undefined && updateBoard(file, { x: n(v) }, 'moved')} label="X" pre="X" />
          <Field value={String(entry.y)} onCommit={(v) => n(v) !== undefined && updateBoard(file, { y: n(v) }, 'moved')} label="Y" pre="Y" />
        </Row>
        <Row label="尺寸">
          <Field value={String(entry.w)} onCommit={(v) => n(v) !== undefined && updateBoard(file, { w: Math.max(40, n(v)!) }, 'resized')} label="宽" pre="W" />
          <Field value={String(entry.h)} onCommit={(v) => n(v) !== undefined && updateBoard(file, { h: Math.max(40, n(v)!) }, 'resized')} label="高" pre="H" />
        </Row>
        <Row label="预设">
          <Select
            value=""
            options={[
              { value: '', label: '选择尺寸…' },
              { value: '390x844', label: '手机 390 × 844' },
              { value: '1280x800', label: '桌面 1280 × 800' },
              { value: '1440x900', label: '桌面 1440 × 900' },
              { value: '1200x760', label: '画板 1200 × 760' },
              { value: '1080x1080', label: '社交方图 1080 × 1080' },
              { value: '816x1056', label: 'Letter 816 × 1056' },
              { value: '794x1123', label: 'A4 794 × 1123' },
            ]}
            onChange={(v) => {
              const [w, h] = v.split('x').map(Number);
              if (w && h) updateBoard(file, { w, h }, 'resized');
            }}
            label="尺寸预设"
          />
        </Row>
        <label className="check">
          <input type="checkbox" checked={!!entry.is_interactive} onChange={(e) => updateBoard(file, { is_interactive: e.currentTarget.checked || undefined }, 'interactive')} />
          可交互（播放时按钮可点）
        </label>
        <label className="check">
          <input type="checkbox" checked={entry.expand === 'fill'} onChange={(e) => updateBoard(file, { expand: e.currentTarget.checked ? 'fill' : undefined }, 'expand')} />
          网页：全屏时铺满窗口
        </label>
      </div>
      <div className="sec">
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => duplicateBoard(file)}>
            复制画板
          </button>
          <button className="btn danger" onClick={() => confirm(`删除画板 ${file}？文件也会被删除（可以用 git 找回）。`) && void deleteBoard(file)}>
            删除画板
          </button>
        </div>
        <span className="hint">文件：{file}</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- tweaks

function TweakField({ file, name, spec }: { file: string; name: string; spec: PropSpec }) {
  const setV = (value: unknown) => edit(file, (src) => setPropDefault(src, name, value).source, { actor: 'human', summary: `tweak ${name} → ${JSON.stringify(value)}` });
  const v = spec.default;
  let control: React.ReactElement;
  switch (spec.editor) {
    case 'color':
      control = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
          {Array.isArray(spec.options) && (
            <div className="swatches">
              {(spec.options as string[]).map((o) => (
                <button key={o} style={{ background: o }} aria-label={o} aria-pressed={o === v} onClick={() => setV(o)} />
              ))}
            </div>
          )}
          <ColorField value={String(v ?? '')} onCommit={setV} label={name} allowNone={false} />
        </div>
      );
      break;
    case 'enum':
      control = (
        <Select value={String(v)} options={(spec.options ?? []).map((o) => ({ value: String(o), label: String(o) }))} onChange={setV} label={name} />
      );
      break;
    case 'boolean':
      control = (
        <label className="check">
          <input type="checkbox" checked={Boolean(v)} onChange={(e) => setV(e.currentTarget.checked)} /> {v ? '开' : '关'}
        </label>
      );
      break;
    case 'int':
    case 'float':
    case 'range':
      control = (
        <>
          {spec.editor === 'range' && (
            <input type="range" min={spec.min ?? 0} max={spec.max ?? 100} step={spec.step ?? 1} defaultValue={Number(v ?? 0)} key={String(v)} aria-label={name} onPointerUp={(e) => setV(Number(e.currentTarget.value))} style={{ flex: 1 }} />
          )}
          <Field value={String(v ?? '')} label={name} unit={spec.unit} onCommit={(s) => setV(spec.editor === 'int' ? parseInt(s, 10) : parseFloat(s))} width={spec.editor === 'range' ? 72 : undefined} />
        </>
      );
      break;
    default:
      control = <Field value={String(v ?? '')} label={name} numeric={false} onCommit={setV} />;
  }
  return <Row label={name}>{control}</Row>;
}

export function Tweaks({ file, doc }: { file: string; doc: DcDoc }) {
  const tweaks = Object.entries(doc.props).filter(([k, s]) => !k.startsWith('$') && s && s.editor);
  return (
    <div className="sec">
      {tweaks.length ? (
        tweaks.map(([k, s]) => <TweakField key={k} file={file} name={k} spec={s} />)
      ) : (
        <span className="hint">这个画板没有声明可调参数。参数写在画板脚本的 data-props 里，比如一个强调色或密度开关。</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- canvas items

const FILLS: (NoteFill | 'default')[] = ['default', 'gray', 'red', 'orange', 'green', 'teal', 'blue', 'purple', 'pink'];

export function ItemProps({ id, note }: { id: string; note: NoteEntry }) {
  const up = (p: Partial<NoteEntry>, what = 'changed') => updateNote(id, p, what);
  const css = (k: string, v: string) =>
    updateNote(id, (n) => {
      const c = { ...(n.css ?? {}) };
      if (v.trim()) c[k] = v.trim();
      else delete c[k];
      n.css = c;
    }, k);
  const num = (v: string) => (Number.isFinite(Number(v)) && v.trim() ? Math.round(Number(v)) : undefined);
  const isText = !note.kind || note.kind === 'title1';
  const line = note.kind === 'line' || note.kind === 'arrow';
  return (
    <>
      {isText && (
        <div className="sec">
          <h3>{note.kind === 'title1' ? '标题' : '便签'}</h3>
          <Row label="字号">
            <Seg
              value={(Object.entries(NOTE_SIZES).find(([, s]) => s === sizeOf(note))?.[0] ?? '') as 's'}
              label="字号"
              options={(Object.keys(NOTE_SIZES) as (keyof typeof NOTE_SIZES)[]).map((k) => ({ value: k, label: k.toUpperCase(), title: `${NOTE_SIZES[k]}px` }))}
              onChange={(k) => up({ size: NOTE_SIZES[k] }, 'size')}
            />
          </Row>
          <Row label="字形">
            <button className="ib" aria-pressed={note.kind === 'title1' ? note.bold !== false : !!note.bold} aria-label="粗体" title="粗体" onClick={() => up({ bold: note.kind === 'title1' ? note.bold === false : !note.bold }, 'bold')}>
              <b>B</b>
            </button>
            <button className="ib" aria-pressed={!!note.italic} aria-label="斜体" title="斜体" onClick={() => up({ italic: !note.italic }, 'italic')}>
              <i>I</i>
            </button>
          </Row>
          <Row label="文字色">
            <div className="swatches">
              {Object.entries(TEXT_COLORS).map(([k, c]) => (
                <button key={k} style={{ background: c }} aria-label={`文字颜色 ${k}`} aria-pressed={(note.color ?? 'default') === k} onClick={() => up({ color: k === 'default' ? undefined : (k as NoteFill) }, 'color')} />
              ))}
            </div>
          </Row>
          {!note.kind && (
            <>
              <Row label="底色">
                <div className="swatches">
                  {FILLS.map((f) => (
                    <button key={f} style={{ background: `var(--note-${f})` }} aria-label={`底色 ${f}`} aria-pressed={(note.fill ?? 'default') === f} onClick={() => up({ fill: f === 'default' ? undefined : f }, 'fill')} />
                  ))}
                </div>
              </Row>
              <Row label="宽">
                <Field value={String(note.w ?? 240)} onCommit={(v) => up({ w: Math.max(80, num(v) ?? 240) }, 'width')} label="宽" unit="px" />
              </Row>
            </>
          )}
        </div>
      )}
      {!isText && (
        <div className="sec">
          <h3>{line ? '线条' : '形状'}</h3>
          <Row label="位置">
            <Field value={String(note.x)} onCommit={(v) => num(v) !== undefined && up({ x: num(v) }, 'moved')} label="X" pre="X" />
            <Field value={String(note.y)} onCommit={(v) => num(v) !== undefined && up({ y: num(v) }, 'moved')} label="Y" pre="Y" />
          </Row>
          {line ? (
            <>
              <Row label="终点">
                <Field value={String(note.x2 ?? note.x)} onCommit={(v) => num(v) !== undefined && up({ x2: num(v) }, 'moved')} label="X2" pre="X" />
                <Field value={String(note.y2 ?? note.y)} onCommit={(v) => num(v) !== undefined && up({ y2: num(v) }, 'moved')} label="Y2" pre="Y" />
              </Row>
              <Row label="起点端">
                <Select
                  value={note.headStart ?? 'none'}
                  options={[
                    { value: 'none', label: '无' },
                    { value: 'open', label: '开放箭头' },
                    { value: 'filled', label: '实心箭头' },
                  ]}
                  onChange={(v) => up({ headStart: v === 'none' ? undefined : (v as 'open') }, 'head')}
                  label="起点端"
                />
              </Row>
              <Row label="终点端">
                <Select
                  value={note.kind === 'arrow' ? (note.headEnd ?? 'filled') : 'none'}
                  options={[
                    { value: 'none', label: '无' },
                    { value: 'open', label: '开放箭头' },
                    { value: 'filled', label: '实心箭头' },
                  ]}
                  onChange={(v) =>
                    updateNote(id, (n) => {
                      n.kind = v === 'none' ? 'line' : 'arrow';
                      if (v === 'open') n.headEnd = 'open';
                      else delete n.headEnd;
                    }, 'head')
                  }
                  label="终点端"
                />
              </Row>
            </>
          ) : (
            <Row label="尺寸">
              <Field value={String(note.w ?? 0)} onCommit={(v) => num(v) !== undefined && up({ w: Math.max(4, num(v)!) }, 'resized')} label="宽" pre="W" />
              <Field value={String(note.h ?? 0)} onCommit={(v) => num(v) !== undefined && up({ h: Math.max(4, num(v)!) }, 'resized')} label="高" pre="H" />
            </Row>
          )}
          {!line && note.kind !== 'pen' && (
            <Row label="填充">
              <ColorField value={note.css?.background ?? ''} onCommit={(v) => css('background', v)} label="填充色" />
            </Row>
          )}
          {(line || note.kind === 'pen') && (
            <Row label="线条">
              <ColorField value={note.css?.stroke ?? '#1d1d1b'} onCommit={(v) => css('stroke', v)} label="线条颜色" allowNone={false} />
              <Field value={note.css?.['stroke-width'] ?? (line ? '2' : '3')} onCommit={(v) => css('stroke-width', v)} label="线条粗细" width={64} />
            </Row>
          )}
          {(note.kind === 'rect' || note.kind === 'image') && (
            <Row label="圆角">
              <Field value={px(note.css?.['border-radius'])} onCommit={(v) => css('border-radius', toLength(v))} label="圆角" unit="px" />
            </Row>
          )}
          {!line && note.kind !== 'pen' && (
            <Row label="描边">
              <Field value={px(note.css?.['border-width'])} placeholder="0" onCommit={(v) => updateNote(id, (n) => {
                const c = { ...(n.css ?? {}) };
                if (v.trim() && v.trim() !== '0') {
                  c['border-width'] = toLength(v);
                  c['border-style'] ??= 'solid';
                  c['border-color'] ??= '#1d1d1b';
                } else {
                  delete c['border-width'];
                  delete c['border-style'];
                }
                n.css = c;
              }, 'border')} label="描边粗细" width={64} unit="px" />
              <ColorField value={note.css?.['border-color'] ?? ''} onCommit={(v) => css('border-color', v)} label="描边颜色" />
            </Row>
          )}
          <Row label="不透明度">
            <Field value={note.css?.opacity ?? ''} placeholder="1" onCommit={(v) => css('opacity', v)} label="不透明度" />
          </Row>
          {!line && (
            <Row label="旋转">
              <Field value={note.rotate ? String(note.rotate) : ''} placeholder="0" onCommit={(v) => up({ rotate: num(v) || undefined }, 'rotated')} label="旋转角度" unit="°" />
            </Row>
          )}
        </div>
      )}
    </>
  );
}

export function useBoardDoc(file: string | null): string | undefined {
  return useStore((s) => (file ? display(s, file) : undefined));
}
