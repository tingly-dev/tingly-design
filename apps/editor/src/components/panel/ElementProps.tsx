import type React from 'react';
import { useState } from 'react';
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
  { id: 'display', label: '大标题', size: 48, weight: 700, lh: '1.1' },
  { id: 'title', label: '标题', size: 32, weight: 700, lh: '1.2' },
  { id: 'h1', label: '标题 1', size: 24, weight: 700, lh: '1.3' },
  { id: 'h2', label: '标题 2', size: 20, weight: 600, lh: '1.35' },
  { id: 'h3', label: '标题 3', size: 15, weight: 700, lh: '1.4' },
  { id: 'body', label: '正文', size: 15, weight: 400, lh: '1.55' },
  { id: 'small', label: '小字', size: 13, weight: 400, lh: '1.5' },
  { id: 'caption', label: '注释', size: 12, weight: 400, lh: '1.4' },
];

/** What a design-system text style sets; choosing one clears the others first. */
const DS_STYLE_PROPS = { 'font-family': 1, 'font-size': 1, 'line-height': 1, 'font-weight': 1, 'letter-spacing': 1, 'font-style': 1 };

const SHADOWS: Record<string, string> = {
  sm: '0 1px 2px rgba(0,0,0,0.08)',
  md: '0 4px 12px rgba(0,0,0,0.10)',
  lg: '0 12px 32px rgba(0,0,0,0.14)',
};

export function ElementProps({ file, el, info }: { file: string; el: DcElement; info: Inspect | null }) {
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
          ? `这是一个循环：里面的内容按数据重复渲染（${info?.count ?? '多'}项）。改里面的元素会同时改到每一项；增减条目需要改画板脚本，交给 AI 或 Claude Code。`
          : el.tag === 'sc-if'
            ? '这是条件块：是否显示由画板脚本里的值决定。'
            : el.tag === 'helmet'
              ? '页面级样式和字体，在“代码”里查看。'
              : '引用的子组件，内部请到它自己的画板里改。'}
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
    { value: 'hug', label: '适应' },
    { value: 'fixed', label: '固定' },
    { value: 'fill', label: '填充' },
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
  const preset = TEXT_STYLES.find((t) => t.size === Math.round(size) && t.weight === weight)?.id ?? '';
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
          这 {info?.count ?? '几'} 个元素由代码按数据重复生成：在这里改样式会同时改到每一项。要单独改其中一项，或改它们的文字，请交给 AI。
        </div>
      )}
      <div className="sec" style={{ paddingTop: 8, paddingBottom: 8 }}>
        <div className="alignrow">
          {alignBtn('x', 'start', <AlignLeft />, '左对齐')}
          {alignBtn('x', 'center', <AlignCenterH />, '水平居中')}
          {alignBtn('x', 'end', <AlignRight />, '右对齐')}
          {alignBtn('y', 'start', <AlignTop />, '顶部对齐')}
          {alignBtn('y', 'center', <AlignMiddle />, '垂直居中')}
          {alignBtn('y', 'end', <AlignBottom />, '底部对齐')}
        </div>
      </div>

      <div className="sec">
        <h3>
          尺寸
          <button className="ib add" aria-label="添加尺寸限制" onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAddMenu({ x: r.right, y: r.bottom + 4 });
          }}>
            <Plus />
          </button>
        </h3>
        <Row label="宽">
          <Field value={px(sv('width'))} placeholder={info ? String(Math.round(info.rect.w)) : ''} onCommit={one('width')} label="宽度" unit={sv('width').endsWith('%') ? '' : 'px'} />
          <Select narrow value={axisMode('w')} options={MODES} onChange={(m) => setMode('w', m)} label="宽度模式" />
        </Row>
        <Row label="高">
          <Field value={px(sv('height'))} placeholder={info ? String(Math.round(info.rect.h)) : ''} onCommit={one('height')} label="高度" unit={sv('height').endsWith('%') ? '' : 'px'} />
          <Select narrow value={axisMode('h')} options={MODES} onChange={(m) => setMode('h', m)} label="高度模式" />
        </Row>
        {(['min-width', 'max-width', 'min-height', 'max-height'] as const)
          .filter((p) => sv(p) || extra.includes(p))
          .map((p) => (
            <Row key={p} label={{ 'min-width': '最小宽', 'max-width': '最大宽', 'min-height': '最小高', 'max-height': '最大高' }[p]}>
              <Field value={px(sv(p))} onCommit={one(p)} label={p} unit="px" />
            </Row>
          ))}
        <Row label="位置">
          <Select
            value={abs ? 'absolute' : 'inline'}
            options={[
              { value: 'inline', label: '跟随布局' },
              { value: 'absolute', label: '绝对定位' },
            ]}
            onChange={(v) =>
              v === 'inline'
                ? set({ position: null, left: null, top: null, right: null, bottom: null })
                : set({ position: 'absolute', left: `${cv('offset-left') || 0}px`, top: `${cv('offset-top') || 0}px`, ...(parent?.position === 'static' ? {} : {}) })
            }
            label="定位"
          />
        </Row>
        {abs && (
          <Row label="偏移">
            <Field value={px(sv('left'))} placeholder={px(cv('left'))} onCommit={one('left')} label="X" pre="X" />
            <Field value={px(sv('top'))} placeholder={px(cv('top'))} onCommit={one('top')} label="Y" pre="Y" />
          </Row>
        )}
        {pFlex && !abs && (
          <Row label="伸展">
            <Field value={sv('flex-grow')} placeholder={cv('flex-grow')} onCommit={(v) => set({ 'flex-grow': v.trim() || null })} label="flex-grow" />
          </Row>
        )}
        {addMenu && (
          <Menu x={addMenu.x} y={addMenu.y} align="right" label="添加尺寸限制" onClose={() => setAddMenu(null)}>
            {(['min-width', 'max-width', 'min-height', 'max-height'] as const).map((p) => (
              <MenuItem key={p} label={{ 'min-width': '最小宽度', 'max-width': '最大宽度', 'min-height': '最小高度', 'max-height': '最大高度' }[p]} onSelect={() => (setExtra((x) => [...x, p]), setAddMenu(null))} />
            ))}
          </Menu>
        )}
      </div>

      <div className="sec">
        <h3>布局</h3>
        <Row label="布局">
          <Select
            value={layout}
            options={[
              { value: 'block', label: '普通' },
              { value: 'stack', label: '堆叠 (flex)' },
              { value: 'grid', label: '网格 (grid)' },
            ]}
            onChange={(v) =>
              v === 'block'
                ? set({ display: null, 'flex-direction': null, 'grid-template-columns': null })
                : v === 'stack'
                  ? set({ display: 'flex', 'flex-direction': 'column', 'grid-template-columns': null, ...(sv('gap') ? {} : { gap: '8px' }) })
                  : set({ display: 'grid', 'flex-direction': null, 'grid-template-columns': 'repeat(2, minmax(0, 1fr))', ...(sv('gap') ? {} : { gap: '8px' }) })
            }
            label="布局方式"
          />
        </Row>
        {layout === 'stack' && (
          <>
            <Row label="方向">
              <Seg
                value={dir}
                label="方向"
                options={[
                  { value: 'row', label: <ArrowRight />, title: '横向' },
                  { value: 'column', label: <ArrowDown />, title: '纵向' },
                ]}
                onChange={(v) => set({ 'flex-direction': v === 'row' ? 'row' : 'column' })}
              />
              <button className="ib" aria-pressed={(sv('flex-wrap') || cv('flex-wrap')) === 'wrap'} title="自动换行" aria-label="自动换行" onClick={() => set({ 'flex-wrap': sv('flex-wrap') === 'wrap' ? null : 'wrap' })}>
                <Wrap />
              </button>
            </Row>
            <Row label="对齐">
              <div className={`matrix ${dir === 'column' ? 'col' : ''}`} role="group" aria-label="对齐方式">
                {(['start', 'center', 'end'] as const).flatMap((y) =>
                  (['start', 'center', 'end'] as const).map((x) => {
                    const main = dir === 'row' ? x : y;
                    const cross = dir === 'row' ? y : x;
                    const on = !between && jc === main && ai === cross;
                    return (
                      <button
                        key={x + y}
                        aria-pressed={on}
                        aria-label={`对齐 ${x}/${y}`}
                        onClick={() => set({ 'justify-content': main === 'start' ? null : pos[main], 'align-items': pos[cross] })}
                      >
                        <i />
                      </button>
                    );
                  }),
                )}
              </div>
              <button className="ib" aria-pressed={between} title="两端分布" aria-label="两端分布" onClick={() => set({ 'justify-content': between ? null : 'space-between' })}>
                ↔
              </button>
            </Row>
          </>
        )}
        {layout === 'grid' && (
          <Row label="列数">
            <Field value={cols} placeholder={cols ? '' : '—'} onCommit={(v) => set({ 'grid-template-columns': /^\d+$/.test(v.trim()) ? `repeat(${v.trim()}, minmax(0, 1fr))` : v.trim() || null })} label="列数" />
          </Row>
        )}
        {layout !== 'block' && (
          <Row label="间距">
            <Field value={px(sv('gap'))} placeholder={px(cv('gap')).replace('normal', '0')} onCommit={one('gap')} label="间距" unit="px" />
          </Row>
        )}
        <Row label="内边距">
          {perSide || !sameP ? (
            <span className="hint" style={{ flex: 1 }}>
              分别设置
            </span>
          ) : (
            <Field value={sv('padding') ? px(sv('padding')) : sv('padding-top') ? pads[0] : ''} placeholder={px(cv('padding-top'))} onCommit={one('padding')} label="内边距" unit="px" />
          )}
          <button className="ib" aria-pressed={perSide || !sameP} title="分别设置四边" aria-label="分别设置四边" onClick={() => setPerSide(!perSide)}>
            <Sides />
          </button>
        </Row>
        {(perSide || !sameP) && (
          <div className="four">
            {(['top', 'right', 'bottom', 'left'] as const).map((s, i) => (
              <Field key={s} value={sv(`padding-${s}`) ? px(sv(`padding-${s}`)) : ''} placeholder={pads[i]} onCommit={one(`padding-${s}`)} label={`内边距 ${s}`} pre={{ top: '上', right: '右', bottom: '下', left: '左' }[s]} />
            ))}
          </div>
        )}
      </div>

      {hasText && (
        <div className="sec">
          <h3>文字</h3>
          <Row label="样式">
            <Select
              value={dsPreset || preset}
              options={[
                { value: '', label: dsPreset || preset ? '' : '自定义' },
                ...dsStyles.map((d) => ({ value: d.id, label: `${d.system} · ${d.style.name} · ${d.decl['font-size']}` })),
                ...(dsStyles.length ? [] : TEXT_STYLES.map((t) => ({ value: t.id, label: `${t.label} · ${t.size}` }))),
              ].filter((o) => o.label)}
              onChange={(id) => {
                const d = dsStyles.find((x) => x.id === id);
                if (d) return set({ ...Object.fromEntries(Object.keys(DS_STYLE_PROPS).map((k) => [k, null])), ...d.decl });
                const t = TEXT_STYLES.find((x) => x.id === id);
                if (t) set({ 'font-size': `${t.size}px`, 'font-weight': String(t.weight), 'line-height': t.lh });
              }}
              label="文字样式"
            />
          </Row>
          <Row label="颜色">
            <ColorField value={sv('color')} computed={cv('color')} onCommit={(v) => set({ color: v.trim() || null })} label="文字颜色" allowNone={false} />
          </Row>
          {ratio !== null && (
            <span className={`contrast ${ratio >= 4.5 || (big && ratio >= 3) ? '' : ratio >= 3 ? 'warn' : 'bad'}`} title={`与背景 ${toHex(info!.backdrop)} 的对比度`}>
              <b>{ratio.toFixed(1)}</b>
              {ratio >= 4.5 || (big && ratio >= 3) ? '对比度足够' : ratio >= 3 ? '只适合大号字' : '对比度不足'}
            </span>
          )}
          <Row label="字号">
            <Field value={px(sv('font-size'))} placeholder={px(cv('font-size'))} onCommit={one('font-size')} label="字号" unit="px" />
            <Select
              narrow
              value={String(weight)}
              options={['300', '400', '500', '600', '700', '800'].map((w) => ({ value: w, label: { '300': '细', '400': '常规', '500': '中', '600': '半粗', '700': '粗', '800': '特粗' }[w]! }))}
              onChange={(w) => set({ 'font-weight': w })}
              label="字重"
            />
          </Row>
          <Row label="行高">
            <Field value={px(sv('line-height'))} placeholder={px(cv('line-height')).replace('normal', '')} onCommit={(v) => set({ 'line-height': v.trim() || null })} label="行高" />
            <Field value={px(sv('letter-spacing'))} placeholder={px(cv('letter-spacing')).replace('normal', '0')} onCommit={one('letter-spacing')} label="字距" pre="字距" />
          </Row>
          <Row label="对齐">
            <Seg
              value={(sv('text-align') || cv('text-align').replace('start', 'left')) as 'left'}
              label="文字对齐"
              options={[
                { value: 'left', label: <TextLeft />, title: '左对齐' },
                { value: 'center', label: <TextCenter />, title: '居中' },
                { value: 'right', label: <TextRight />, title: '右对齐' },
                { value: 'justify', label: <TextJustify />, title: '两端对齐' },
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
          <h3>外观</h3>
          <Row label="填充">
            <ColorField value={bg} computed={cv('background-color')} onCommit={(v) => set({ background: v.trim() || null, 'background-color': null })} label="填充色" />
            {bg && (
              <button className="ib" title="去掉填充" aria-label="去掉填充" onClick={() => set({ background: null, 'background-color': null })}>
                <NoneI />
              </button>
            )}
          </Row>
          <Row label="不透明度">
            <Field value={sv('opacity')} placeholder={cv('opacity') || '1'} onCommit={(v) => set({ opacity: v.trim() || null })} label="不透明度" />
          </Row>
          <Row label="圆角">
            {perCorner || radii.some(Boolean) ? (
              <span className="hint" style={{ flex: 1 }}>
                分别设置
              </span>
            ) : (
              <Field value={px(sv('border-radius'))} placeholder={px(cv('border-radius'))} onCommit={one('border-radius')} label="圆角" unit="px" />
            )}
            <button className="ib" aria-pressed={perCorner || radii.some(Boolean)} title="分别设置四角" aria-label="分别设置四角" onClick={() => setPerCorner(!perCorner)}>
              <Corners />
            </button>
          </Row>
          {(perCorner || radii.some(Boolean)) && (
            <div className="four">
              {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((c) => (
                <Field key={c} value={px(sv(`border-${c}-radius`))} placeholder={px(sv('border-radius')) || '0'} onCommit={one(`border-${c}-radius`)} label={`圆角 ${c}`} pre={{ 'top-left': '↖', 'top-right': '↗', 'bottom-left': '↙', 'bottom-right': '↘' }[c]} />
              ))}
            </div>
          )}
          <Row label="描边">
            <Seg
              value={borderStyle}
              label="描边样式"
              options={[
                { value: 'none', label: <NoneI />, title: '无' },
                { value: 'solid', label: '——', title: '实线' },
                { value: 'dashed', label: '- - -', title: '虚线' },
                { value: 'dotted', label: '···', title: '点线' },
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
              <Field value={px(sv('border-width'))} placeholder={px(cv('border-top-width'))} onCommit={one('border-width')} label="描边粗细" unit="px" width={80} />
              <ColorField value={sv('border-color')} computed={cv('border-top-color')} onCommit={(v) => set({ 'border-color': v.trim() || null })} label="描边颜色" />
            </Row>
          )}
        </div>
      )}

      {el.ns !== 'svg' && (
        <div className="sec">
          <h3>效果</h3>
          <Row label="阴影">
            <Select
              value={shadowKey}
              options={[
                { value: 'none', label: '无' },
                { value: 'sm', label: '轻' },
                { value: 'md', label: '中' },
                { value: 'lg', label: '重' },
                ...(shadowKey === 'custom' ? [{ value: 'custom', label: '自定义' }] : []),
              ]}
              onChange={(v) => set({ 'box-shadow': v === 'none' ? null : (SHADOWS[v] ?? shadow) })}
              label="阴影"
            />
          </Row>
          <Row label="溢出">
            <Seg
              value={(sv('overflow') || cv('overflow')) === 'hidden' ? 'hidden' : 'visible'}
              label="溢出"
              options={[
                { value: 'visible', label: '显示' },
                { value: 'hidden', label: '裁切' },
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
      <h3>外观</h3>
      <Row label="填充">
        <ColorField value={own('fill')} computed={inherited('fill') || '#000000'} onCommit={put('fill')} label="填充色" />
      </Row>
      <Row label="描边">
        <ColorField value={own('stroke')} computed={inherited('stroke')} onCommit={put('stroke')} label="描边颜色" />
        <Field value={own('stroke-width')} placeholder={inherited('stroke-width') || '1'} onCommit={put('stroke-width')} label="描边粗细" width={64} />
      </Row>
      <Row label="不透明度">
        <Field value={own('opacity')} placeholder={inherited('opacity') || '1'} onCommit={put('opacity')} label="不透明度" />
      </Row>
    </div>
  );
}
