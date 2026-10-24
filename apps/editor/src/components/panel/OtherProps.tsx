import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BOARD_SIZES, needsRelayout, NOTE_SIZES, boardTweaks, formatTime, setPropDefault, timeSpec, type TimeSpec, type BoardEntry, type DcDoc, type NoteEntry, type NoteFill, type PropSpec } from '@dc/core';
import { duplicateBoard, resizeBoard, updateBoard, updateNote } from '../../actions';
import { readPref, writePref } from '../../local';
import { delegateToClaude } from '../../fastedit';
import { deleteBoard, display, edit, useStore } from '../../store';
import { TEXT_COLORS, sizeOf } from '../canvas/Item';
import { frames } from '../canvas/Board';
import { PauseFilled, PlayFilled } from '../icons';
import { ColorField, Field, Row, Seg, Select, px, toLength } from './fields';

// ---------------------------------------------------------------- artboard

/** Whether a new artboard size also rescales the page inside it (on unless the person turned it off). */
const SCALE_PREF = 'dc.scaleOnResize';

export function BoardProps({ file, entry }: { file: string; entry: BoardEntry }) {
  const { t } = useTranslation();
  const [scale, setScale] = useState(() => readPref(SCALE_PREF) !== 'off');
  const [shifted, setShifted] = useState<[number, number] | null>(null);
  useEffect(() => setShifted(null), [file]);
  const resize = (w: number, h: number) => {
    setShifted(scale && needsRelayout([entry.w, entry.h], [w, h]) ? [w, h] : null);
    resizeBoard(file, w, h, scale);
  };
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
          <Field value={String(entry.w)} onCommit={(v) => n(v) !== undefined && resize(Math.max(40, n(v)!), entry.h)} label={t('panel.field.w')} pre="W" />
          <Field value={String(entry.h)} onCommit={(v) => n(v) !== undefined && resize(entry.w, Math.max(40, n(v)!))} label={t('panel.field.h')} pre="H" />
        </Row>
        <Row label={t('panel.board.preset')}>
          <Select
            value=""
            options={[
              { value: '', label: t('panel.board.presetPlaceholder') },
              ...BOARD_SIZES.map((p) => ({ value: `${p.size[0]}x${p.size[1]}`, label: `${t(`canvas.boardSize.${p.id}`)} ${p.size[0]} × ${p.size[1]}`, group: t(`canvas.boardGroup.${p.group}`) })),
            ]}
            onChange={(v) => {
              const [w, h] = v.split('x').map(Number);
              if (w && h) resize(w, h);
            }}
            label={t('panel.board.presetLabel')}
          />
        </Row>
        <label className="check">
          <input type="checkbox" checked={scale} onChange={(e) => { setScale(e.currentTarget.checked); writePref(SCALE_PREF, e.currentTarget.checked ? 'on' : 'off'); }} />
          {t('panel.board.scaleContent')}
        </label>
        {shifted && (
          <div className="hint">
            {t('panel.board.relayoutHint')}
            <br />
            <button className="btn sm" onClick={() => void delegateToClaude(file, null, `Re-lay out ${file} for a ${shifted[0]}×${shifted[1]} artboard: the page was scaled from another shape, so rearrange sections (stack columns, resize or reorder blocks) so everything fits and reads well at this size. Keep the copy, the style and the template values.`).finally(() => setShifted(null))}>
              {t('panel.board.relayoutAsk')}
            </button>
          </div>
        )}
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

export function TweakField({ file, name, spec }: { file: string; name: string; spec: PropSpec }) {
  const setV = (value: unknown) => edit(file, (src) => setPropDefault(src, name, value).source, { actor: 'human', summary: `tweak ${name} → ${JSON.stringify(value)}` });
  return <TweakControl name={name} spec={spec} value={spec.default} onSet={setV} />;
}

/** One tweak's control, by its editor: an artboard's own default, or what an embed of it sets. */
export function TweakControl({ name, spec, value: v, onSet: setV }: { name: string; spec: PropSpec; value: unknown; onSet: (value: unknown) => void }) {
  const { t } = useTranslation();
  let control: React.ReactElement;
  // a list (or any object) is edited on the artboard, row by row; as a text field it would be written back as one string
  if (v !== null && typeof v === 'object')
    return (
      <Row label={name}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          {Array.isArray(v) && <span>{t('panel.tweaks.list', { count: v.length })}</span>}
          <span className="hint">{t('panel.tweaks.listHint')}</span>
        </div>
      </Row>
    );
  switch (spec.editor) {
    case 'color':
      control = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
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
  const tweaks = boardTweaks(doc.props);
  const time = timeSpec(doc.props);
  return (
    <div className="sec">
      {time && <TimeScrub key={file} file={file} spec={time} />}
      {tweaks.length ? (
        tweaks.map(([k, s]) => <TweakField key={k} file={file} name={k} spec={s} />)
      ) : (
        <span className="hint">{t('panel.tweaks.empty')}</span>
      )}
    </div>
  );
}

/**
 * An artboard that moves with time (`$time`): look at it at any moment, or
 * play it. Only the frame on the canvas changes; the file keeps its still.
 */
function TimeScrub({ file, spec }: { file: string; spec: TimeSpec }) {
  const { t } = useTranslation();
  const span = spec.loop ?? Math.max(6000, spec.still * 2);
  const [at, setAt] = useState(spec.still);
  const [playing, setPlaying] = useState(false);
  const seek = (ms: number) => frames.get(file)?.contentWindow?.postMessage({ dcMotion: 'seek', t: ms, n: -1 }, '*');
  const atRef = useRef(at);
  atRef.current = at;
  useEffect(() => {
    if (!playing) return;
    const t0 = performance.now() - atRef.current;
    let raf = 0;
    const tick = () => {
      const ms = (performance.now() - t0) % span;
      setAt(Math.round(ms));
      seek(ms);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, span, file]);
  // back to the still when the panel goes
  useEffect(() => () => seek(spec.still), [file, spec.still]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Row label={t('panel.tweaks.time')}>
      <button className="tb" aria-label={playing ? t('panel.tweaks.pause') : t('panel.tweaks.play')} aria-pressed={playing} onClick={() => setPlaying(!playing)}>
        {playing ? <PauseFilled /> : <PlayFilled />}
      </button>
      <input
        type="range"
        min={0}
        max={span}
        step={10}
        value={at}
        aria-label={t('panel.tweaks.time')}
        onChange={(e) => {
          setPlaying(false);
          const ms = Number(e.currentTarget.value);
          setAt(ms);
          seek(ms);
        }}
        style={{ flex: 1, minWidth: 0 }}
      />
      <span className="faint" style={{ font: '11px var(--mono)', minWidth: 40, textAlign: 'right' }}>
        {formatTime(at)}
      </span>
    </Row>
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
