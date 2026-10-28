import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useInstalled } from '../ds/ds';

/** Number-ish CSS lengths: "16" → "16px"; keeps %, rem, auto, calc(), holes as typed. */
export function toLength(v: string, unit = 'px'): string {
  const t = v.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return t + unit;
  return t;
}

export function px(v: string | undefined): string {
  if (!v) return '';
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim());
  return m ? String(Math.round(parseFloat(m[1]) * 10) / 10) : v;
}

export function Row({ label, children, title }: { label: ReactNode; children: ReactNode; title?: string }) {
  return (
    <div className="r" title={title}>
      <span className="lab">{label}</span>
      <div className="ctl">{children}</div>
    </div>
  );
}

/**
 * A text input that commits on Enter or blur. `value` is what the source
 * says; `placeholder` shows the computed value when the source says nothing.
 */
export function Field({
  value,
  placeholder,
  onCommit,
  label,
  unit,
  pre,
  numeric = true,
  width,
  step,
}: {
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  label: string;
  unit?: string;
  pre?: string;
  numeric?: boolean;
  width?: number;
  /** Arrow-key step (Shift takes ten of them), for values smaller than whole numbers. Default 1. */
  step?: number;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return (
    <label className={`inp ${value === '' && placeholder ? 'computed' : ''}`} style={width ? { flex: `0 0 ${width}px` } : undefined}>
      {pre && <span className="pre">{pre}</span>}
      <input
        value={text}
        placeholder={placeholder}
        aria-label={label}
        inputMode={numeric ? 'decimal' : undefined}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setText(value);
            setTimeout(() => (e.target as HTMLInputElement).blur());
          }
          if (numeric && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            const cur = text || placeholder || '0';
            const m = /^(-?\d+(?:\.\d+)?)(.*)$/.exec(cur.trim());
            if (!m) return;
            e.preventDefault();
            const by = (e.shiftKey ? 10 : 1) * (step ?? 1) * (e.key === 'ArrowUp' ? 1 : -1);
            const next = `${Math.round((parseFloat(m[1]) + by) * 100) / 100}${m[2]}`;
            setText(next);
            onCommit(next);
          }
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </label>
  );
}

/** Colour value → #rrggbb for <input type=color>; anything else falls back to white. */
export function toHex(v: string | undefined): string {
  if (!v) return '#ffffff';
  const s = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s.slice(1).replace(/./g, (c) => c + c).toLowerCase();
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
  if (m) return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  const named: Record<string, string> = { white: '#ffffff', black: '#000000' };
  return named[s] ?? '#ffffff';
}

export function isTransparent(v: string | undefined): boolean {
  if (!v) return true;
  return v === 'transparent' || /rgba?\([^)]*,\s*0\s*\)$/.test(v) || v === 'none';
}

export function ColorField({
  value,
  computed,
  onCommit,
  label,
  allowNone = true,
  bound,
  onCommitBound,
}: {
  value: string;
  computed?: string;
  onCommit: (v: string) => void;
  label: string;
  allowNone?: boolean;
  /** the colour is one hole of the template: a colour tweak (edited through `onCommitBound`) or a value from the script */
  bound?: { name: string; tweak: boolean };
  onCommitBound?: (name: string) => (v: string) => void;
}) {
  const { t } = useTranslation();
  const shown = value || computed || '';
  const none = !shown || isTransparent(shown);
  const commit = bound?.tweak && onCommitBound ? onCommitBound(bound.name) : onCommit;
  const systems = useInstalled();
  const [open, setOpen] = useState(false);
  // the token this value is, when a design system is installed (its first theme)
  const same = (a: string, b: string) => a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();
  const token = shown
    ? systems.flatMap((x) => x.tokens.colors.map((c) => ({ c, v: c.values[x.tokens.themes[0].id] }))).find(({ v }) => same(v, shown) || (/^#/.test(v) && toHex(v) === toHex(shown) && /^(#|rgb)/.test(shown)))
    : undefined;
  return (
    <div className="colorfield">
      <label className={`inp ${value === '' ? 'computed' : ''}`}>
        <span className={`swatch ${none ? 'none' : ''}`} style={none ? undefined : { background: shown }}>
          <input type="color" aria-label={t('panel.color.pickerLabel', { label })} value={toHex(shown)} onChange={(e) => commit(e.currentTarget.value)} />
        </span>
        <ColorText value={value} placeholder={none ? (allowNone ? t('common.none') : '') : toHex(shown)} onCommit={commit} label={label} />
        {bound ? (
          <span className="tokname" title={t(bound.tweak ? 'panel.color.boundTo' : 'panel.color.fromScript', { name: bound.name })}>{bound.name}</span>
        ) : (
          token && <span className="tokname" title={t('panel.color.tokenHint')}>{token.c.name}</span>
        )}
        {systems.some((x) => x.tokens.colors.length) && (
          <button type="button" className="tokbtn" aria-label={t('panel.color.fromDsLabel', { label })} aria-expanded={open} title={t('panel.color.fromDs')} onClick={(e) => (e.preventDefault(), setOpen(!open))}>
            ◆
          </button>
        )}
      </label>
      {open && (
        <div className="tokpick" role="listbox" aria-label={t('panel.color.dsColorsLabel', { label })}>
          {systems.map((x) => (
            <div key={x.record.namespace}>
              {systems.length > 1 && <div className="hint">{x.record.title}</div>}
              <div className="tokgrid">
                {x.tokens.colors.map((c) => {
                  const v = c.values[x.tokens.themes[0].id];
                  return (
                    <button
                      key={c.name}
                      type="button"
                      role="option"
                      aria-selected={token?.c === c}
                      title={`${c.name} ${v}${c.usage ? `\n${c.usage}` : ''}`}
                      onClick={() => {
                        commit(v);
                        setOpen(false);
                      }}
                    >
                      <span className="sw" style={{ background: v }} />
                      <span className="nm">{c.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ColorText({ value, placeholder, onCommit, label }: { value: string; placeholder: string; onCommit: (v: string) => void; label: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      value={text}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

export function Select({
  value,
  options,
  onChange,
  label,
  narrow,
}: {
  value: string;
  options: { value: string; label: string; group?: string }[];
  onChange: (v: string) => void;
  label: string;
  narrow?: boolean;
}) {
  const opts = options.some((o) => o.value === value) ? options : [...options, { value, label: value || '—' }];
  return (
    <select className={`sel-inp ${narrow ? 'narrow' : ''}`} aria-label={label} value={value} onChange={(e) => onChange(e.currentTarget.value)}>
      {opts
        .filter((o) => !o.group)
        .map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      {[...new Set(opts.map((o) => o.group).filter(Boolean))].map((g) => (
        <optgroup key={g} label={g}>
          {opts
            .filter((o) => o.group === g)
            .map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------- contrast

function lum(hex: string): number {
  const h = toHex(hex);
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
