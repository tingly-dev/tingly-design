import type React from 'react';
import { useTranslation } from 'react-i18next';
import { NOTE_SIZES, setPropDefault, type BoardEntry, type DcDoc, type NoteEntry, type NoteFill, type PropSpec } from '@dc/core';
import { duplicateBoard, updateBoard, updateNote } from '../../actions';
import { deleteBoard, display, edit, useStore } from '../../store';
import { TEXT_COLORS, sizeOf } from '../Item';
import { ColorField, Field, Row, Seg, Select, px, toLength } from './fields';

// ---------------------------------------------------------------- artboard

export function BoardProps({ file, entry }: { file: string; entry: BoardEntry }) {
  const { t } = useTranslation();
  const n = (v: string) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : undefined);
  return (
    <>
      <div className="sec">
        <h3>{t('panel.board.title')}</h3>
        <Row label={t('panel.field.name')}>
          <Field value={entry.title ?? ''} placeholder={file} numeric={false} onCommit={(v) => updateBoard(file, { title: v.trim() || undefined }, 'renamed')} label={t('panel.board.nameLabel')} />
        </Row>
        <Row label={t('panel.field.position')}>
          <Field value={String(entry.x)} onCommit={(v) => n(v) !== undefined && updateBoard(file, { x: n(v) }, 'moved')} label="X" pre="X" />
          <Field value={String(entry.y)} onCommit={(v) => n(v) !== undefined && updateBoard(file, { y: n(v) }, 'moved')} label="Y" pre="Y" />
        </Row>
        <Row label={t('panel.field.size')}>
          <Field value={String(entry.w)} onCommit={(v) => n(v) !== undefined && updateBoard(file, { w: Math.max(40, n(v)!) }, 'resized')} label={t('panel.field.w')} pre="W" />
          <Field value={String(entry.h)} onCommit={(v) => n(v) !== undefined && updateBoard(file, { h: Math.max(40, n(v)!) }, 'resized')} label={t('panel.field.h')} pre="H" />
        </Row>
        <Row label={t('panel.board.preset')}>
          <Select
            value=""
            options={[
              { value: '', label: t('panel.board.presetPlaceholder') },
              { value: '390x844', label: t('panel.board.presetPhone', { w: 390, h: 844 }) },
              { value: '1280x800', label: t('panel.board.presetDesktop', { w: 1280, h: 800 }) },
              { value: '1440x900', label: t('panel.board.presetDesktop', { w: 1440, h: 900 }) },
              { value: '1200x760', label: t('panel.board.presetArtboard', { w: 1200, h: 760 }) },
              { value: '1080x1080', label: t('panel.board.presetSocial', { w: 1080, h: 1080 }) },
              { value: '816x1056', label: 'Letter 816 × 1056' },
              { value: '794x1123', label: 'A4 794 × 1123' },
            ]}
            onChange={(v) => {
              const [w, h] = v.split('x').map(Number);
              if (w && h) updateBoard(file, { w, h }, 'resized');
            }}
            label={t('panel.board.presetLabel')}
          />
        </Row>
        <label className="check">
          <input type="checkbox" checked={!!entry.is_interactive} onChange={(e) => updateBoard(file, { is_interactive: e.currentTarget.checked || undefined }, 'interactive')} />
          {t('panel.board.interactive')}
        </label>
        <label className="check">
          <input type="checkbox" checked={entry.expand === 'fill'} onChange={(e) => updateBoard(file, { expand: e.currentTarget.checked ? 'fill' : undefined }, 'expand')} />
          {t('panel.board.fill')}
        </label>
      </div>
      <div className="sec">
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => duplicateBoard(file)}>
            {t('panel.board.duplicate')}
          </button>
          <button className="btn danger" onClick={() => confirm(t('panel.board.deleteConfirm', { file })) && void deleteBoard(file)}>
            {t('panel.board.delete')}
          </button>
        </div>
        <span className="hint">{t('panel.board.file', { file })}</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- tweaks

function TweakField({ file, name, spec }: { file: string; name: string; spec: PropSpec }) {
  const { t } = useTranslation();
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
          <input type="checkbox" checked={Boolean(v)} onChange={(e) => setV(e.currentTarget.checked)} /> {v ? t('panel.tweaks.on') : t('panel.tweaks.off')}
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
  const { t } = useTranslation();
  const tweaks = Object.entries(doc.props).filter(([k, s]) => !k.startsWith('$') && s && s.editor);
  return (
    <div className="sec">
      {tweaks.length ? (
        tweaks.map(([k, s]) => <TweakField key={k} file={file} name={k} spec={s} />)
      ) : (
        <span className="hint">{t('panel.tweaks.empty')}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- canvas items

const FILLS: (NoteFill | 'default')[] = ['default', 'gray', 'red', 'orange', 'green', 'teal', 'blue', 'purple', 'pink'];

export function ItemProps({ id, note }: { id: string; note: NoteEntry }) {
  const { t } = useTranslation();
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
          <h3>{note.kind === 'title1' ? t('panel.item.title') : t('panel.item.note')}</h3>
          <Row label={t('panel.field.fontSize')}>
            <Seg
              value={(Object.entries(NOTE_SIZES).find(([, s]) => s === sizeOf(note))?.[0] ?? '') as 's'}
              label={t('panel.field.fontSize')}
              options={(Object.keys(NOTE_SIZES) as (keyof typeof NOTE_SIZES)[]).map((k) => ({ value: k, label: k.toUpperCase(), title: `${NOTE_SIZES[k]}px` }))}
              onChange={(k) => up({ size: NOTE_SIZES[k] }, 'size')}
            />
          </Row>
          <Row label={t('panel.field.fontStyle')}>
            <button className="ib" aria-pressed={note.kind === 'title1' ? note.bold !== false : !!note.bold} aria-label={t('panel.field.bold')} title={t('panel.field.bold')} onClick={() => up({ bold: note.kind === 'title1' ? note.bold === false : !note.bold }, 'bold')}>
              <b>B</b>
            </button>
            <button className="ib" aria-pressed={!!note.italic} aria-label={t('panel.field.italic')} title={t('panel.field.italic')} onClick={() => up({ italic: !note.italic }, 'italic')}>
              <i>I</i>
            </button>
          </Row>
          <Row label={t('panel.field.textColorRow')}>
            <div className="swatches">
              {Object.entries(TEXT_COLORS).map(([k, c]) => (
                <button key={k} style={{ background: c }} aria-label={t('panel.field.textColorOf', { color: k })} aria-pressed={(note.color ?? 'default') === k} onClick={() => up({ color: k === 'default' ? undefined : (k as NoteFill) }, 'color')} />
              ))}
            </div>
          </Row>
          {!note.kind && (
            <>
              <Row label={t('panel.field.noteFill')}>
                <div className="swatches">
                  {FILLS.map((f) => (
                    <button key={f} style={{ background: `var(--note-${f})` }} aria-label={t('panel.field.noteFillOf', { color: f })} aria-pressed={(note.fill ?? 'default') === f} onClick={() => up({ fill: f === 'default' ? undefined : f }, 'fill')} />
                  ))}
                </div>
              </Row>
              <Row label={t('panel.field.w')}>
                <Field value={String(note.w ?? 240)} onCommit={(v) => up({ w: Math.max(80, num(v) ?? 240) }, 'width')} label={t('panel.field.w')} unit="px" />
              </Row>
            </>
          )}
        </div>
      )}
      {!isText && (
        <div className="sec">
          <h3>{line ? t('panel.item.lineSection') : t('panel.item.shapeSection')}</h3>
          <Row label={t('panel.field.position')}>
            <Field value={String(note.x)} onCommit={(v) => num(v) !== undefined && up({ x: num(v) }, 'moved')} label="X" pre="X" />
            <Field value={String(note.y)} onCommit={(v) => num(v) !== undefined && up({ y: num(v) }, 'moved')} label="Y" pre="Y" />
          </Row>
          {line ? (
            <>
              <Row label={t('panel.item.endPoint')}>
                <Field value={String(note.x2 ?? note.x)} onCommit={(v) => num(v) !== undefined && up({ x2: num(v) }, 'moved')} label="X2" pre="X" />
                <Field value={String(note.y2 ?? note.y)} onCommit={(v) => num(v) !== undefined && up({ y2: num(v) }, 'moved')} label="Y2" pre="Y" />
              </Row>
              <Row label={t('panel.item.startCap')}>
                <Select
                  value={note.headStart ?? 'none'}
                  options={[
                    { value: 'none', label: t('common.none') },
                    { value: 'open', label: t('panel.item.openArrow') },
                    { value: 'filled', label: t('panel.item.filledArrow') },
                  ]}
                  onChange={(v) => up({ headStart: v === 'none' ? undefined : (v as 'open') }, 'head')}
                  label={t('panel.item.startCap')}
                />
              </Row>
              <Row label={t('panel.item.endCap')}>
                <Select
                  value={note.kind === 'arrow' ? (note.headEnd ?? 'filled') : 'none'}
                  options={[
                    { value: 'none', label: t('common.none') },
                    { value: 'open', label: t('panel.item.openArrow') },
                    { value: 'filled', label: t('panel.item.filledArrow') },
                  ]}
                  onChange={(v) =>
                    updateNote(id, (n) => {
                      n.kind = v === 'none' ? 'line' : 'arrow';
                      if (v === 'open') n.headEnd = 'open';
                      else delete n.headEnd;
                    }, 'head')
                  }
                  label={t('panel.item.endCap')}
                />
              </Row>
            </>
          ) : (
            <Row label={t('panel.field.size')}>
              <Field value={String(note.w ?? 0)} onCommit={(v) => num(v) !== undefined && up({ w: Math.max(4, num(v)!) }, 'resized')} label={t('panel.field.w')} pre="W" />
              <Field value={String(note.h ?? 0)} onCommit={(v) => num(v) !== undefined && up({ h: Math.max(4, num(v)!) }, 'resized')} label={t('panel.field.h')} pre="H" />
            </Row>
          )}
          {!line && note.kind !== 'pen' && (
            <Row label={t('panel.field.fill')}>
              <ColorField value={note.css?.background ?? ''} onCommit={(v) => css('background', v)} label={t('panel.field.fillColor')} />
            </Row>
          )}
          {(line || note.kind === 'pen') && (
            <Row label={t('panel.field.line')}>
              <ColorField value={note.css?.stroke ?? '#1d1d1b'} onCommit={(v) => css('stroke', v)} label={t('panel.field.lineColor')} allowNone={false} />
              <Field value={note.css?.['stroke-width'] ?? (line ? '2' : '3')} onCommit={(v) => css('stroke-width', v)} label={t('panel.field.lineWidth')} width={64} />
            </Row>
          )}
          {(note.kind === 'rect' || note.kind === 'image') && (
            <Row label={t('panel.field.radius')}>
              <Field value={px(note.css?.['border-radius'])} onCommit={(v) => css('border-radius', toLength(v))} label={t('panel.field.radius')} unit="px" />
            </Row>
          )}
          {!line && note.kind !== 'pen' && (
            <Row label={t('panel.field.border')}>
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
              }, 'border')} label={t('panel.field.borderWidth')} width={64} unit="px" />
              <ColorField value={note.css?.['border-color'] ?? ''} onCommit={(v) => css('border-color', v)} label={t('panel.field.borderColor')} />
            </Row>
          )}
          <Row label={t('panel.field.opacity')}>
            <Field value={note.css?.opacity ?? ''} placeholder="1" onCommit={(v) => css('opacity', v)} label={t('panel.field.opacity')} />
          </Row>
          {!line && (
            <Row label={t('panel.field.rotation')}>
              <Field value={note.rotate ? String(note.rotate) : ''} placeholder="0" onCommit={(v) => up({ rotate: num(v) || undefined }, 'rotated')} label={t('panel.field.rotationLabel')} unit="°" />
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
