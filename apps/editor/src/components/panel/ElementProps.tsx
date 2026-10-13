import type React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { attr, getStyle, isRepeated, roleOf, styleDeclarations, styleInFormat, templateText, type DcElement, type Inspect } from '@dc/core';
import { useInstalled } from '../../ds';
import { display, editElement, parsed, useStore } from '../../store';
import { Menu, MenuItem } from '../Menu';
import {
  AlignBottom,
  AlignCenterH,
  AlignLeft,
  AlignMiddle,
  AlignRight,
  AlignTop,
  ArrowDown,
  ArrowRight,
  Corners,
  NoneI,
  Plus,
  Sides,
  TextCenter,
  TextJustify,
  TextLeft,
  TextRight,
  Wrap,
} from '../icons';
import { ColorField, Field, Row, Seg, Select, contrastRatio, isTransparent, px, toHex, toLength } from './fields';

type Set_ = Record<string, string | null>;

export const TEXT_STYLES = [
  { id: 'display', size: 48, weight: 700, lh: '1.1' },
  { id: 'title', size: 32, weight: 700, lh: '1.2' },
  { id: 'h1', size: 24, weight: 700, lh: '1.3' },
  { id: 'h2', size: 20, weight: 600, lh: '1.35' },
  { id: 'h3', size: 15, weight: 700, lh: '1.4' },
  { id: 'body', size: 15, weight: 400, lh: '1.55' },
  { id: 'small', size: 13, weight: 400, lh: '1.5' },
  { id: 'caption', size: 12, weight: 400, lh: '1.4' },
] as const;

/** What a design-system text style sets; choosing one clears the others first. */
const DS_STYLE_PROPS = { 'font-family': 1, 'font-size': 1, 'line-height': 1, 'font-weight': 1, 'letter-spacing': 1, 'font-style': 1 };

const SHADOWS: Record<string, string> = {
  sm: '0 1px 2px rgba(0,0,0,0.08)',
  md: '0 4px 12px rgba(0,0,0,0.10)',
  lg: '0 12px 32px rgba(0,0,0,0.14)',
};

export function ElementProps({ file, el, info }: { file: string; el: DcElement; info: Inspect | null }) {
  const { t } = useTranslation();
  const tid = el.tid;
  // a motion scene in a format other than the primary one shows that format's look
  const view = useStore((s) => s.motionView);
  const style =
    view && view.format !== view.primary
      ? styleInFormat(Object.fromEntries(el.attrs.map((a) => [a.name, a.value])), view.format)
      : (attr(el, 'style') ?? '');
  const sv = (p: string) => getStyle(style, p) ?? '';
  const cv = (p: string) => info?.computed[p] ?? '';
  const installed = useInstalled();
  const slides = useStore((s) => s.kind === 'slides' || s.kind === 'motion');
  const set = (s: Set_) => editElement(file, [{ kind: 'styles', tid, set: s }]);
  const one = (p: string) => (v: string) => set({ [p]: v.trim() === '' ? null : toLength(v) });
  const parent = info?.parent;
  const pFlex = !!parent && parent.display.includes('flex');
  const pGrid = !!parent && parent.display.includes('grid');
  const pRow = pFlex && !parent!.flexDirection.startsWith('column');
  const abs = (sv('position') || cv('position')) === 'absolute';
  const special = el.tag.startsWith('sc-') || el.tag === 'helmet' || el.tag === 'dc-import';
  const doc = parsed(display(useStore.getState(), file) ?? '');
  const repeated = isRepeated(doc, tid) || (info?.count ?? 1) > 1;
  const role = roleOf(el);
  const hasText = !!templateText(el) || role === 'Text' || role === 'Button' || role === 'Link';
  const [perSide, setPerSide] = useState(false);
  const [perCorner, setPerCorner] = useState(false);
  const [extra, setExtra] = useState<string[]>([]);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);

  if (special)
    return (
      <div className="notice">
        {el.tag === 'sc-for'
          ? info?.count != null
            ? t('panel.el.loop', { count: info.count })
            : t('panel.el.loopUnknown')
          : el.tag === 'sc-if'
            ? t('panel.el.condition')
            : el.tag === 'helmet'
              ? t('panel.el.helmet')
              : t('panel.el.import')}
      </div>
    );

  // ------------------------------------------------------------- size
  const axisMode = (axis: 'w' | 'h'): 'hug' | 'fixed' | 'fill' => {
    const prop = axis === 'w' ? 'width' : 'height';
    const v = sv(prop);
    const main = pFlex && (axis === 'w' ? pRow : !pRow);
    const grow = sv('flex') || sv('flex-grow');
    if (v === '100%') return 'fill';
    if (main && /^[1-9]/.test(grow)) return 'fill';
    if (pFlex && !main && sv('align-self') === 'stretch') return 'fill';
    if (v && v !== 'auto' && v !== 'fit-content' && v !== 'max-content') return 'fixed';
    return 'hug';
  };
  const setMode = (axis: 'w' | 'h', mode: string) => {
    const prop = axis === 'w' ? 'width' : 'height';
    const main = pFlex && (axis === 'w' ? pRow : !pRow);
    const clear: Set_ = { [prop]: null, ...(main ? { flex: null, 'flex-grow': null } : {}), ...(sv('align-self') === 'stretch' && !main ? { 'align-self': null } : {}) };
    if (mode === 'hug') set(clear);
    else if (mode === 'fixed') set({ ...clear, [prop]: `${Math.round(axis === 'w' ? (info?.rect.w ?? 0) : (info?.rect.h ?? 0))}px` });
    else if (main) set({ ...clear, flex: '1 1 0', [axis === 'w' ? 'min-width' : 'min-height']: '0' });
    else if (pFlex) set({ ...clear, 'align-self': 'stretch' });
    else set({ ...clear, [prop]: '100%' });
  };
  const MODES = [
    { value: 'hug', label: t('panel.el.mode.hug') },
    { value: 'fixed', label: t('panel.el.mode.fixed') },
    { value: 'fill', label: t('panel.el.mode.fill') },
  ];

  // ------------------------------------------------------------- layout
  const display_ = cv('display') || sv('display');
  const layout = /flex/.test(display_) ? 'stack' : /grid/.test(display_) ? 'grid' : 'block';
  const dir = (sv('flex-direction') || cv('flex-direction') || 'row').startsWith('column') ? 'column' : 'row';
  const norm = (v: string) => (v === 'center' ? 'center' : /end|right|bottom/.test(v) ? 'end' : 'start');
  const jc = norm(sv('justify-content') || cv('justify-content'));
  const ai = norm(sv('align-items') || cv('align-items'));
  const between = /space-between/.test(sv('justify-content') || cv('justify-content'));
  const cols = /repeat\(\s*(\d+)/.exec(sv('grid-template-columns'))?.[1] ?? '';
  const pads = ['top', 'right', 'bottom', 'left'].map((s) => sv(`padding-${s}`) || px(cv(`padding-${s}`)));
  const sameP = pads.every((p) => p === pads[0]);
  const radii = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => sv(`border-${c}-radius`));
  const pos = { start: 'flex-start', center: 'center', end: 'flex-end' } as const;

  // ------------------------------------------------------------- text
  const size = parseFloat(sv('font-size') || cv('font-size')) || 0;
  const weight = parseInt(sv('font-weight') || cv('font-weight'), 10) || 400;
  const preset = TEXT_STYLES.find((s) => s.size === Math.round(size) && s.weight === weight)?.id ?? '';
  // a design system's type styles, as the declarations they write (px on slides: the subset has no rem)
  const dsStyles = installed.flatMap((x) =>
    x.tokens.groups.flatMap((g) =>
      g.styles.map((st) => ({ id: `ds:${x.record.namespace}:${st.name}`, system: x.record.title, style: st, decl: styleDeclarations(x.tokens, st, g, slides) })),
    ),
  );
  const dsPreset =
    dsStyles.find((d) => Object.entries(d.decl).every(([k, v]) => (sv(k) || '').replace(/\s+/g, '') === v.replace(/\s+/g, '')))?.id ?? '';
  const color = sv('color') || cv('color');
  const ratio = info && color && !isTransparent(color) ? contrastRatio(color, info.backdrop) : null;
  const big = size >= 24 || (size >= 18.66 && weight >= 700);

  // ------------------------------------------------------------- appearance
  const bg = sv('background') || sv('background-color');
  const borderStyle = (() => {
    const b = sv('border');
    if (b === 'none' || b === '0') return 'none';
    const s = sv('border-style') || /\b(solid|dashed|dotted)\b/.exec(b)?.[1] || cv('border-top-style');
    const w = parseFloat(cv('border-top-width'));
    return !w || s === 'none' ? 'none' : (s as 'solid' | 'dashed' | 'dotted');
  })();
  const shadow = sv('box-shadow');
  const shadowKey = !shadow || shadow === 'none' ? 'none' : (Object.entries(SHADOWS).find(([, v]) => v === shadow)?.[0] ?? 'custom');

  const alignOpts = (axis: 'x' | 'y') => {
    const prop = pGrid ? (axis === 'x' ? 'justify-self' : 'align-self') : 'align-self';
    const active = pGrid || (pFlex && (axis === 'x' ? !pRow : pRow));
    return { prop, active };
  };
  const alignBtn = (axis: 'x' | 'y', where: 'start' | 'center' | 'end', icon: React.ReactElement, label: string) => {
    const { prop, active } = alignOpts(axis);
    const blockX = !pFlex && !pGrid && axis === 'x' && !abs;
    const pressed = active ? norm(sv(prop)) === where && !!sv(prop) : blockX ? (where === 'center' ? sv('margin-left') === 'auto' && sv('margin-right') === 'auto' : where === 'end' ? sv('margin-left') === 'auto' && sv('margin-right') !== 'auto' : false) : false;
    return (
      <button
        className="ib"
        title={label}
        aria-label={label}
        aria-pressed={pressed}
        disabled={!active && !blockX}
        onClick={() => {
          if (active) set({ [prop]: pressed ? null : pos[where] });
          else if (blockX) set(where === 'start' ? { 'margin-left': null, 'margin-right': null } : where === 'center' ? { 'margin-left': 'auto', 'margin-right': 'auto' } : { 'margin-left': 'auto', 'margin-right': '0' });
        }}
      >
        {icon}
      </button>
    );
  };

  return (
    <>
      {repeated && (
        <div className="notice">
          {info?.count != null ? t('panel.el.repeated', { count: info.count }) : t('panel.el.repeatedUnknown')}
        </div>
      )}
      <div className="sec" style={{ paddingTop: 8, paddingBottom: 8 }}>
        <div className="alignrow">
          {alignBtn('x', 'start', <AlignLeft />, t('panel.el.align.left'))}
          {alignBtn('x', 'center', <AlignCenterH />, t('panel.el.align.centerH'))}
          {alignBtn('x', 'end', <AlignRight />, t('panel.el.align.right'))}
          {alignBtn('y', 'start', <AlignTop />, t('panel.el.align.top'))}
          {alignBtn('y', 'center', <AlignMiddle />, t('panel.el.align.middle'))}
          {alignBtn('y', 'end', <AlignBottom />, t('panel.el.align.bottom'))}
        </div>
      </div>

      <div className="sec">
        <h3>
          {t('panel.field.size')}
          <button className="ib add" aria-label={t('panel.el.addLimit')} onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAddMenu({ x: r.right, y: r.bottom + 4 });
          }}>
            <Plus />
          </button>
        </h3>
        <Row label={t('panel.field.w')}>
          <Field value={px(sv('width'))} placeholder={info ? String(Math.round(info.rect.w)) : ''} onCommit={one('width')} label={t('panel.field.width')} unit={sv('width').endsWith('%') ? '' : 'px'} />
          <Select narrow value={axisMode('w')} options={MODES} onChange={(m) => setMode('w', m)} label={t('panel.el.widthMode')} />
        </Row>
        <Row label={t('panel.field.h')}>
          <Field value={px(sv('height'))} placeholder={info ? String(Math.round(info.rect.h)) : ''} onCommit={one('height')} label={t('panel.field.height')} unit={sv('height').endsWith('%') ? '' : 'px'} />
          <Select narrow value={axisMode('h')} options={MODES} onChange={(m) => setMode('h', m)} label={t('panel.el.heightMode')} />
        </Row>
        {(['min-width', 'max-width', 'min-height', 'max-height'] as const)
          .filter((p) => sv(p) || extra.includes(p))
          .map((p) => (
            <Row key={p} label={{ 'min-width': t('panel.el.limitRow.minWidth'), 'max-width': t('panel.el.limitRow.maxWidth'), 'min-height': t('panel.el.limitRow.minHeight'), 'max-height': t('panel.el.limitRow.maxHeight') }[p]}>
              <Field value={px(sv(p))} onCommit={one(p)} label={p} unit="px" />
            </Row>
          ))}
        <Row label={t('panel.field.position')}>
          <Select
            value={abs ? 'absolute' : 'inline'}
            options={[
              { value: 'inline', label: t('panel.el.inFlow') },
              { value: 'absolute', label: t('panel.el.absolute') },
            ]}
            onChange={(v) =>
              v === 'inline'
                ? set({ position: null, left: null, top: null, right: null, bottom: null })
                : set({ position: 'absolute', left: `${cv('offset-left') || 0}px`, top: `${cv('offset-top') || 0}px`, ...(parent?.position === 'static' ? {} : {}) })
            }
            label={t('panel.el.positioning')}
          />
        </Row>
        {abs && (
          <Row label={t('panel.el.offset')}>
            <Field value={px(sv('left'))} placeholder={px(cv('left'))} onCommit={one('left')} label="X" pre="X" />
            <Field value={px(sv('top'))} placeholder={px(cv('top'))} onCommit={one('top')} label="Y" pre="Y" />
          </Row>
        )}
        {pFlex && !abs && (
          <Row label={t('panel.el.grow')}>
            <Field value={sv('flex-grow')} placeholder={cv('flex-grow')} onCommit={(v) => set({ 'flex-grow': v.trim() || null })} label="flex-grow" />
          </Row>
        )}
        {addMenu && (
          <Menu x={addMenu.x} y={addMenu.y} align="right" label={t('panel.el.addLimit')} onClose={() => setAddMenu(null)}>
            {(['min-width', 'max-width', 'min-height', 'max-height'] as const).map((p) => (
              <MenuItem key={p} label={{ 'min-width': t('panel.el.limit.minWidth'), 'max-width': t('panel.el.limit.maxWidth'), 'min-height': t('panel.el.limit.minHeight'), 'max-height': t('panel.el.limit.maxHeight') }[p]} onSelect={() => (setExtra((x) => [...x, p]), setAddMenu(null))} />
            ))}
          </Menu>
        )}
      </div>

      <div className="sec">
        <h3>{t('panel.el.layout')}</h3>
        <Row label={t('panel.el.layout')}>
          <Select
            value={layout}
            options={[
              { value: 'block', label: t('panel.el.layoutBlock') },
              { value: 'stack', label: t('panel.el.layoutStack') },
              { value: 'grid', label: t('panel.el.layoutGrid') },
            ]}
            onChange={(v) =>
              v === 'block'
                ? set({ display: null, 'flex-direction': null, 'grid-template-columns': null })
                : v === 'stack'
                  ? set({ display: 'flex', 'flex-direction': 'column', 'grid-template-columns': null, ...(sv('gap') ? {} : { gap: '8px' }) })
                  : set({ display: 'grid', 'flex-direction': null, 'grid-template-columns': 'repeat(2, minmax(0, 1fr))', ...(sv('gap') ? {} : { gap: '8px' }) })
            }
            label={t('panel.el.layoutLabel')}
          />
        </Row>
        {layout === 'stack' && (
          <>
            <Row label={t('panel.el.direction')}>
              <Seg
                value={dir}
                label={t('panel.el.direction')}
                options={[
                  { value: 'row', label: <ArrowRight />, title: t('panel.el.horizontal') },
                  { value: 'column', label: <ArrowDown />, title: t('panel.el.vertical') },
                ]}
                onChange={(v) => set({ 'flex-direction': v === 'row' ? 'row' : 'column' })}
              />
              <button className="ib" aria-pressed={(sv('flex-wrap') || cv('flex-wrap')) === 'wrap'} title={t('panel.el.wrap')} aria-label={t('panel.el.wrap')} onClick={() => set({ 'flex-wrap': sv('flex-wrap') === 'wrap' ? null : 'wrap' })}>
                <Wrap />
              </button>
            </Row>
            <Row label={t('panel.el.alignRow')}>
              <div className={`matrix ${dir === 'column' ? 'col' : ''}`} role="group" aria-label={t('panel.el.alignment')}>
                {(['start', 'center', 'end'] as const).flatMap((y) =>
                  (['start', 'center', 'end'] as const).map((x) => {
                    const main = dir === 'row' ? x : y;
                    const cross = dir === 'row' ? y : x;
                    const on = !between && jc === main && ai === cross;
                    return (
                      <button
                        key={x + y}
                        aria-pressed={on}
                        aria-label={t('panel.el.alignCell', { x, y })}
                        onClick={() => set({ 'justify-content': main === 'start' ? null : pos[main], 'align-items': pos[cross] })}
                      >
                        <i />
                      </button>
                    );
                  }),
                )}
              </div>
              <button className="ib" aria-pressed={between} title={t('panel.el.spaceBetween')} aria-label={t('panel.el.spaceBetween')} onClick={() => set({ 'justify-content': between ? null : 'space-between' })}>
                ↔
              </button>
            </Row>
          </>
        )}
        {layout === 'grid' && (
          <Row label={t('panel.el.columns')}>
            <Field value={cols} placeholder={cols ? '' : '—'} onCommit={(v) => set({ 'grid-template-columns': /^\d+$/.test(v.trim()) ? `repeat(${v.trim()}, minmax(0, 1fr))` : v.trim() || null })} label={t('panel.el.columns')} />
          </Row>
        )}
        {layout !== 'block' && (
          <Row label={t('panel.el.gap')}>
            <Field value={px(sv('gap'))} placeholder={px(cv('gap')).replace('normal', '0')} onCommit={one('gap')} label={t('panel.el.gap')} unit="px" />
          </Row>
        )}
        <Row label={t('panel.el.padding')}>
          {perSide || !sameP ? (
            <span className="hint" style={{ flex: 1 }}>
              {t('panel.field.individually')}
            </span>
          ) : (
            <Field value={sv('padding') ? px(sv('padding')) : sv('padding-top') ? pads[0] : ''} placeholder={px(cv('padding-top'))} onCommit={one('padding')} label={t('panel.el.padding')} unit="px" />
          )}
          <button className="ib" aria-pressed={perSide || !sameP} title={t('panel.el.paddingSides')} aria-label={t('panel.el.paddingSides')} onClick={() => setPerSide(!perSide)}>
            <Sides />
          </button>
        </Row>
        {(perSide || !sameP) && (
          <div className="four">
            {(['top', 'right', 'bottom', 'left'] as const).map((s, i) => (
              <Field key={s} value={sv(`padding-${s}`) ? px(sv(`padding-${s}`)) : ''} placeholder={pads[i]} onCommit={one(`padding-${s}`)} label={t('panel.el.paddingSide', { side: s })} pre={t(`panel.el.side.${s}`)} />
            ))}
          </div>
        )}
      </div>

      {hasText && (
        <div className="sec">
          <h3>{t('panel.el.text')}</h3>
          <Row label={t('panel.el.style')}>
            <Select
              value={dsPreset || preset}
              options={[
                { value: '', label: dsPreset || preset ? '' : t('panel.field.custom') },
                ...dsStyles.map((d) => ({ value: d.id, label: `${d.system} · ${d.style.name} · ${d.decl['font-size']}` })),
                ...(dsStyles.length ? [] : TEXT_STYLES.map((s) => ({ value: s.id, label: `${t(`panel.el.textStyles.${s.id}`)} · ${s.size}` }))),
              ].filter((o) => o.label)}
              onChange={(id) => {
                const d = dsStyles.find((x) => x.id === id);
                if (d) return set({ ...Object.fromEntries(Object.keys(DS_STYLE_PROPS).map((k) => [k, null])), ...d.decl });
                const ts = TEXT_STYLES.find((x) => x.id === id);
                if (ts) set({ 'font-size': `${ts.size}px`, 'font-weight': String(ts.weight), 'line-height': ts.lh });
              }}
              label={t('panel.el.textStyle')}
            />
          </Row>
          <Row label={t('panel.field.color')}>
            <ColorField value={sv('color')} computed={cv('color')} onCommit={(v) => set({ color: v.trim() || null })} label={t('panel.field.textColor')} allowNone={false} />
          </Row>
          {ratio !== null && (
            <span className={`contrast ${ratio >= 4.5 || (big && ratio >= 3) ? '' : ratio >= 3 ? 'warn' : 'bad'}`} title={t('panel.el.contrastTitle', { color: toHex(info!.backdrop) })}>
              <b>{ratio.toFixed(1)}</b>
              {ratio >= 4.5 || (big && ratio >= 3) ? t('panel.el.contrastOk') : ratio >= 3 ? t('panel.el.contrastLarge') : t('panel.el.contrastLow')}
            </span>
          )}
          <Row label={t('panel.field.fontSize')}>
            <Field value={px(sv('font-size'))} placeholder={px(cv('font-size'))} onCommit={one('font-size')} label={t('panel.field.fontSize')} unit="px" />
            <Select
              narrow
              value={String(weight)}
              options={['300', '400', '500', '600', '700', '800'].map((w) => ({ value: w, label: t(`panel.el.weights.${w}`) }))}
              onChange={(w) => set({ 'font-weight': w })}
              label={t('panel.el.weight')}
            />
          </Row>
          <Row label={t('panel.el.lineHeight')}>
            <Field value={px(sv('line-height'))} placeholder={px(cv('line-height')).replace('normal', '')} onCommit={(v) => set({ 'line-height': v.trim() || null })} label={t('panel.el.lineHeight')} />
            <Field value={px(sv('letter-spacing'))} placeholder={px(cv('letter-spacing')).replace('normal', '0')} onCommit={one('letter-spacing')} label={t('panel.el.letterSpacing')} pre={t('panel.el.letterSpacingPre')} />
          </Row>
          <Row label={t('panel.el.alignRow')}>
            <Seg
              value={(sv('text-align') || cv('text-align').replace('start', 'left')) as 'left'}
              label={t('panel.el.textAlign')}
              options={[
                { value: 'left', label: <TextLeft />, title: t('panel.el.align.left') },
                { value: 'center', label: <TextCenter />, title: t('panel.el.center') },
                { value: 'right', label: <TextRight />, title: t('panel.el.align.right') },
                { value: 'justify', label: <TextJustify />, title: t('panel.el.justify') },
              ]}
              onChange={(v) => set({ 'text-align': v === 'left' ? null : v })}
            />
          </Row>
        </div>
      )}

      {el.ns === 'svg' ? (
        <SvgLook file={file} el={el} />
      ) : (
        <div className="sec">
          <h3>{t('panel.el.appearance')}</h3>
          <Row label={t('panel.field.fill')}>
            <ColorField value={bg} computed={cv('background-color')} onCommit={(v) => set({ background: v.trim() || null, 'background-color': null })} label={t('panel.field.fillColor')} />
            {bg && (
              <button className="ib" title={t('panel.el.removeFill')} aria-label={t('panel.el.removeFill')} onClick={() => set({ background: null, 'background-color': null })}>
                <NoneI />
              </button>
            )}
          </Row>
          <Row label={t('panel.field.opacity')}>
            <Field value={sv('opacity')} placeholder={cv('opacity') || '1'} onCommit={(v) => set({ opacity: v.trim() || null })} label={t('panel.field.opacity')} />
          </Row>
          <Row label={t('panel.field.radius')}>
            {perCorner || radii.some(Boolean) ? (
              <span className="hint" style={{ flex: 1 }}>
                {t('panel.field.individually')}
              </span>
            ) : (
              <Field value={px(sv('border-radius'))} placeholder={px(cv('border-radius'))} onCommit={one('border-radius')} label={t('panel.field.radius')} unit="px" />
            )}
            <button className="ib" aria-pressed={perCorner || radii.some(Boolean)} title={t('panel.el.radiusCorners')} aria-label={t('panel.el.radiusCorners')} onClick={() => setPerCorner(!perCorner)}>
              <Corners />
            </button>
          </Row>
          {(perCorner || radii.some(Boolean)) && (
            <div className="four">
              {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((c) => (
                <Field key={c} value={px(sv(`border-${c}-radius`))} placeholder={px(sv('border-radius')) || '0'} onCommit={one(`border-${c}-radius`)} label={t('panel.el.radiusCorner', { corner: c })} pre={{ 'top-left': '↖', 'top-right': '↗', 'bottom-left': '↙', 'bottom-right': '↘' }[c]} />
              ))}
            </div>
          )}
          <Row label={t('panel.field.border')}>
            <Seg
              value={borderStyle}
              label={t('panel.field.borderStyle')}
              options={[
                { value: 'none', label: <NoneI />, title: t('common.none') },
                { value: 'solid', label: '——', title: t('panel.el.solid') },
                { value: 'dashed', label: '- - -', title: t('panel.el.dashed') },
                { value: 'dotted', label: '···', title: t('panel.el.dotted') },
              ]}
              onChange={(v) =>
                v === 'none'
                  ? set({ border: null, 'border-style': null, 'border-width': null, 'border-color': null })
                  : borderStyle === 'none'
                    ? set({ border: `1px ${v} #d0d4dc` })
                    : set({ 'border-style': v })
              }
            />
          </Row>
          {borderStyle !== 'none' && (
            <Row label="">
              <Field value={px(sv('border-width'))} placeholder={px(cv('border-top-width'))} onCommit={one('border-width')} label={t('panel.field.borderWidth')} unit="px" width={80} />
              <ColorField value={sv('border-color')} computed={cv('border-top-color')} onCommit={(v) => set({ 'border-color': v.trim() || null })} label={t('panel.field.borderColor')} />
            </Row>
          )}
        </div>
      )}

      {el.ns !== 'svg' && (
        <div className="sec">
          <h3>{t('panel.el.effects')}</h3>
          <Row label={t('panel.el.shadow')}>
            <Select
              value={shadowKey}
              options={[
                { value: 'none', label: t('common.none') },
                { value: 'sm', label: t('panel.el.shadows.sm') },
                { value: 'md', label: t('panel.el.shadows.md') },
                { value: 'lg', label: t('panel.el.shadows.lg') },
                ...(shadowKey === 'custom' ? [{ value: 'custom', label: t('panel.field.custom') }] : []),
              ]}
              onChange={(v) => set({ 'box-shadow': v === 'none' ? null : (SHADOWS[v] ?? shadow) })}
              label={t('panel.el.shadow')}
            />
          </Row>
          <Row label={t('panel.el.overflow')}>
            <Seg
              value={(sv('overflow') || cv('overflow')) === 'hidden' ? 'hidden' : 'visible'}
              label={t('panel.el.overflow')}
              options={[
                { value: 'visible', label: t('panel.el.overflowVisible') },
                { value: 'hidden', label: t('panel.el.overflowHidden') },
              ]}
              onChange={(v) => set({ overflow: v === 'hidden' ? 'hidden' : null })}
            />
          </Row>
        </div>
      )}
    </>
  );
}

/**
 * A shape inside an SVG (an imported drawing): its paint lives in the fill,
 * stroke and stroke-width attributes, so that is what is edited, in place.
 * Empty means "inherit from the group", as in SVG itself.
 */
function SvgLook({ file, el }: { file: string; el: DcElement }) {
  const { t } = useTranslation();
  const tid = el.tid;
  const put = (name: string) => (v: string) => editElement(file, [{ kind: 'attr', tid, name, value: v.trim() || null }]);
  const own = (name: string) => attr(el, name) ?? '';
  // the nearest group that sets it, shown as the placeholder
  const inherited = (name: string) => {
    for (let p = el.parent; p && p.ns === 'svg'; p = p.parent) {
      const v = attr(p, name);
      if (v) return v;
    }
    return '';
  };
  return (
    <div className="sec">
      <h3>{t('panel.el.appearance')}</h3>
      <Row label={t('panel.field.fill')}>
        <ColorField value={own('fill')} computed={inherited('fill') || '#000000'} onCommit={put('fill')} label={t('panel.field.fillColor')} />
      </Row>
      <Row label={t('panel.field.stroke')}>
        <ColorField value={own('stroke')} computed={inherited('stroke')} onCommit={put('stroke')} label={t('panel.field.strokeColor')} />
        <Field value={own('stroke-width')} placeholder={inherited('stroke-width') || '1'} onCommit={put('stroke-width')} label={t('panel.field.strokeWidth')} width={64} />
      </Row>
      <Row label={t('panel.field.opacity')}>
        <Field value={own('opacity')} placeholder={inherited('opacity') || '1'} onCommit={put('opacity')} label={t('panel.field.opacity')} />
      </Row>
    </div>
  );
}
