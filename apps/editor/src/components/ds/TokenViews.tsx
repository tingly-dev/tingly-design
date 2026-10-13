import { useMemo, useRef, useState } from 'react';
import { styleDeclarations, type DsColor, type DsTokens, type DsTypeGroup, type DsTypeStyle } from '@dc/core';
import { addFonts, editTokens, familyList } from '../../ds';
import { contrastRatio, toHex } from '../panel/fields';

/**
 * Token views: colours per theme, type styles, and the plain families
 * (spacing, radius, shadow, anything else). Every edit is a change of
 * tokens.json as data; the server rebuilds tokens.css from it.
 */

function unique(t: DsTokens, stem: string): string {
  const taken = new Set([...t.colors.map((c) => c.name), ...t.others.flatMap((f) => f.tokens.map((x) => x.name))]);
  for (let i = 1; ; i++) if (!taken.has(`${stem}-${i}`)) return `${stem}-${i}`;
}

/** Names before the last "-000" / "-strong" read as one group ("bg-000", "bg-100" → bg). */
function stemOf(name: string): string {
  const n = /^(.+?)[-_.]\d+$/.exec(name);
  return n ? n[1] : name.split(/[-_.]/)[0];
}

const isHex = (v: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);

/** The surfaces a colour's usage note names ("on surface and surface-raised"), with the contrast to each. */
function contrasts(t: DsTokens, c: DsColor, theme: string): { on: string; ratio: number }[] {
  if (!c.usage) return [];
  const v = c.values[theme];
  if (!isHex(v)) return [];
  const out: { on: string; ratio: number }[] = [];
  const words: string[] = (c.usage.toLowerCase().match(/[a-z0-9][a-z0-9_.-]*/g) ?? []).map((w) => w.replace(/[.]+$/, ''));
  const after = words.indexOf('on');
  if (after < 0) return [];
  for (const w of words.slice(after + 1)) {
    const other = t.colors.find((x) => x.name.toLowerCase() === w && x.name !== c.name);
    if (!other || out.some((o) => o.on === other.name)) continue;
    const ov = other.values[theme];
    if (isHex(ov)) out.push({ on: other.name, ratio: contrastRatio(v, ov) });
  }
  return out;
}

function TextInput({ value, onCommit, label, mono, area, placeholder }: { value: string; onCommit: (v: string) => void; label: string; mono?: boolean; area?: boolean; placeholder?: string }) {
  const [text, setText] = useState(value);
  const last = useRef(value);
  if (last.current !== value) {
    last.current = value;
    setText(value);
  }
  const common = {
    value: text,
    'aria-label': label,
    placeholder,
    className: `dsin ${mono ? 'mono' : ''}`,
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: () => text !== value && onCommit(text),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !area) (e.currentTarget as HTMLElement).blur();
      if (e.key === 'Escape') setText(value);
    },
  };
  return area ? <textarea rows={2} {...common} /> : <input {...common} />;
}

// ------------------------------------------------------------------ colors

function ColorRow({ t, c, theme, open, onToggle }: { t: DsTokens; c: DsColor; theme: string; open: boolean; onToggle: () => void }) {
  const v = c.values[theme];
  const list = contrasts(t, c, theme);
  const at = (json: Record<string, unknown>) => familyList(json, 'color').find((x) => x.name === c.name);
  const setValue = (th: string, value: string) =>
    editTokens((json) => {
      const tok = at(json);
      if (!tok) return;
      const cur = tok.value;
      if (t.themes.length === 1 || (typeof cur === 'string' && th === t.themes[0].id && t.themes.length === 1)) tok.value = value;
      else {
        const per: Record<string, string> = typeof cur === 'string' ? Object.fromEntries(t.themes.map((x) => [x.id, cur])) : { ...(cur as Record<string, string>) };
        per[th] = value;
        tok.value = per;
      }
    }, `color ${c.name} (${th}) → ${value}`);
  const rename = (name: string) => {
    const n = name.trim();
    if (!n || n === c.name) return;
    editTokens((json) => {
      for (const tok of familyList(json, 'color')) {
        if (tok.name === c.name) tok.name = n;
        // aliases follow the rename
        const val = tok.value;
        const fix = (s: unknown) => (typeof s === 'string' && s.replace(/\s/g, '') === `{${c.name}}` ? `{${n}}` : s);
        if (typeof val === 'string') tok.value = fix(val);
        else if (val && typeof val === 'object') for (const k of Object.keys(val)) (val as Record<string, unknown>)[k] = fix((val as Record<string, unknown>)[k]);
      }
    }, `color ${c.name} renamed to ${n}`);
  };
  return (
    <div className={`dsrow ${open ? 'open' : ''}`} data-token={c.name}>
      <button className="dshead" onClick={onToggle} aria-expanded={open}>
        <span className="sw" style={{ background: v }} />
        <span className="nm">{c.name}</span>
        <code className="val">{c.alias[theme] ? `→ ${c.alias[theme]}` : c.raw[theme]}</code>
        <span className="us">{c.usage}</span>
        <span className="cr">
          {list.map((x) => (
            <span key={x.on} className={`ratio ${x.ratio >= 4.5 ? 'ok' : x.ratio >= 3 ? 'mid' : 'bad'}`} title={`在 ${x.on} 上的对比度`}>
              {x.ratio.toFixed(1)} · {x.on}
            </span>
          ))}
        </span>
      </button>
      {open && (
        <div className="dsedit">
          <label>
            名称
            <TextInput value={c.name} onCommit={rename} label="颜色名称" mono />
          </label>
          {t.themes.map((th) => (
            <label key={th.id}>
              {th.name}
              <span className="cv">
                <input
                  type="color"
                  aria-label={`${th.name} 取色`}
                  value={isHex(c.values[th.id]) ? toHex(c.values[th.id]) : '#000000'}
                  onChange={(e) => setValue(th.id, e.target.value)}
                />
                <TextInput value={c.raw[th.id] ?? ''} onCommit={(x) => setValue(th.id, x.trim())} label={`${th.name} 的值`} mono placeholder="#rrggbb、oklch()… 或 {别的颜色}" />
              </span>
            </label>
          ))}
          <label>
            用法
            <TextInput value={c.usage ?? ''} label="用法说明" area onCommit={(x) => editTokens((json) => void (at(json) && (at(json)!.usage = x.trim() || undefined)), `color ${c.name} usage`)} placeholder="它用在哪里、在什么底色上可读：on surface and surface-raised" />
          </label>
          <div className="acts">
            <button className="btn outline danger" onClick={() => editTokens((json) => {
              const l = familyList(json, 'color');
              l.splice(l.findIndex((x) => x.name === c.name), 1);
            }, `color ${c.name} removed`)}>
              删除这个颜色
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ColorsView({ t, theme }: { t: DsTokens; theme: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, DsColor[]>();
    for (const c of t.colors) {
      const s = stemOf(c.name);
      m.set(s, [...(m.get(s) ?? []), c]);
    }
    return [...m.entries()];
  }, [t]);
  const add = () => {
    const name = unique(t, 'color');
    editTokens((json) => {
      familyList(json, 'color').push({ name, value: '#888888', usage: '' });
    }, `color ${name} added`);
    setOpen(name);
  };
  return (
    <section className="dsview" aria-label="颜色">
      <header>
        <h2>颜色</h2>
        <span className="hint">{t.colors.length} 个 · 主题 {t.themes.map((x) => x.name).join(' / ')}</span>
        <button className="btn outline" onClick={add}>
          + 添加颜色
        </button>
      </header>
      {groups.map(([stem, list]) => (
        <div key={stem} className="dsgroup">
          {list.length > 1 && <h3>{stem}</h3>}
          {list.map((c) => (
            <ColorRow key={c.name} t={t} c={c} theme={theme} open={open === c.name} onToggle={() => setOpen(open === c.name ? null : c.name)} />
          ))}
        </div>
      ))}
      {!t.colors.length && <p className="hint">还没有颜色。</p>}
    </section>
  );
}

// -------------------------------------------------------------- typography

function StyleRow({ t, g, gi, s, open, onToggle }: { t: DsTokens; g: DsTypeGroup; gi: number; s: DsTypeStyle; open: boolean; onToggle: () => void }) {
  const css = styleDeclarations(t, s, g);
  const style = Object.fromEntries(Object.entries(css).map(([k, v]) => [k.replace(/-([a-z])/g, (_, x: string) => x.toUpperCase()), v]));
  const set = (key: string, value: string | number | undefined) =>
    editTokens((json) => {
      const groups = ((json.type as { groups?: { styles?: Record<string, unknown>[] }[] })?.groups ?? []);
      const st = groups[gi]?.styles?.find((x) => x.name === s.name);
      if (!st) return;
      if (value === undefined || value === '') delete st[key];
      else st[key] = value;
    }, `type style ${s.name} ${key}`);
  const fields: [string, string, string | undefined][] = [
    ['fontSize', '字号', s.fontSize],
    ['lineHeight', '行高', s.lineHeight],
    ['fontWeight', '字重', s.fontWeight],
    ['letterSpacing', '字距', s.letterSpacing],
  ];
  return (
    <div className={`dsrow ${open ? 'open' : ''}`} data-style={s.name}>
      <button className="dshead tstyle" onClick={onToggle} aria-expanded={open}>
        <span className="sample" style={style}>
          {s.sample ?? '敏捷的狐狸跳过懒狗 The quick brown fox'}
        </span>
        <span className="meta">
          <b>{s.name}</b> {s.fontSize}
          {s.lineHeight ? ` / ${s.lineHeight}` : ''} · {s.fontWeight ?? '400'}
        </span>
      </button>
      {open && (
        <div className="dsedit">
          <div className="grid4">
            {fields.map(([k, label, v]) => (
              <label key={k}>
                {label}
                <TextInput value={v ?? ''} label={label} mono onCommit={(x) => set(k, /^\d+(\.\d+)?$/.test(x.trim()) && k !== 'fontSize' && k !== 'letterSpacing' ? Number(x) : x.trim())} />
              </label>
            ))}
          </div>
          <label>
            字体族
            <select className="dsin" value={s.family ?? ''} onChange={(e) => set('family', e.target.value || undefined)} aria-label="字体族">
              <option value="">跟随这一组（{g.family ?? '无'}）</option>
              {Object.keys(t.families).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label>
            示例文字
            <TextInput value={s.sample ?? ''} label="示例文字" onCommit={(x) => set('sample', x.trim() || undefined)} />
          </label>
          <label>
            用法
            <TextInput value={s.usage ?? ''} label="用法" area onCommit={(x) => set('usage', x.trim() || undefined)} />
          </label>
          <div className="acts">
            <button className="btn outline danger" onClick={() => editTokens((json) => {
              const st = (json.type as { groups?: { styles?: Record<string, unknown>[] }[] })?.groups?.[gi]?.styles;
              if (st) st.splice(st.findIndex((x) => x.name === s.name), 1);
            }, `type style ${s.name} removed`)}>
              删除这个样式
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TypeView({ t }: { t: DsTokens }) {
  const [open, setOpen] = useState<string | null>(null);
  const fontInput = useRef<HTMLInputElement>(null);
  const typeOf = (json: Record<string, unknown>) => {
    const ty = (json.type ??= { fonts: [], families: {}, groups: [] }) as { fonts?: unknown[]; families?: Record<string, string>; groups?: { name: string; family?: string; styles: unknown[] }[] };
    ty.fonts ??= [];
    ty.families ??= {};
    ty.groups ??= [];
    return ty;
  };
  const addStyle = (gi: number) => {
    const names = new Set(t.groups.flatMap((g) => g.styles.map((s) => s.name)));
    let i = 1;
    while (names.has(`style-${i}`)) i++;
    editTokens((json) => {
      const ty = typeOf(json);
      if (!ty.groups![gi]) ty.groups!.push({ name: 'Text', family: Object.keys(t.families)[0], styles: [] });
      ty.groups![gi].styles.push({ name: `style-${i}`, fontSize: '16px', lineHeight: 1.5, fontWeight: 400 });
    }, `type style style-${i} added`);
    setOpen(`style-${i}`);
  };
  return (
    <section className="dsview" aria-label="文字">
      <header>
        <h2>文字</h2>
        <span className="hint">{t.groups.reduce((n, g) => n + g.styles.length, 0)} 个样式</span>
      </header>
      {t.groups.map((g, gi) => (
        <div key={gi} className="dsgroup">
          <h3>
            {g.name}
            {g.family && <span className="hint"> · {g.family}</span>}
          </h3>
          {g.note && <p className="hint">{g.note}</p>}
          {g.styles.map((s) => (
            <StyleRow key={s.name} t={t} g={g} gi={gi} s={s} open={open === s.name} onToggle={() => setOpen(open === s.name ? null : s.name)} />
          ))}
          <button className="btn ghost" onClick={() => addStyle(gi)}>
            + 添加样式
          </button>
        </div>
      ))}
      {!t.groups.length && (
        <button className="btn outline" onClick={() => addStyle(0)}>
          + 添加第一个文字样式
        </button>
      )}
      <div className="dsgroup">
        <h3>字体族</h3>
        {Object.entries(t.families).map(([k, v]) => (
          <div key={k} className="kv">
            <code>{k}</code>
            <TextInput value={v} label={`字体族 ${k}`} mono onCommit={(x) => editTokens((json) => void (typeOf(json).families![k] = x.trim()), `family ${k}`)} />
          </div>
        ))}
        <button
          className="btn ghost"
          onClick={() => {
            const k = prompt('字体族的名字（如 serif、display）')?.trim().toLowerCase();
            if (k && /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(k)) editTokens((json) => void (typeOf(json).families![k] = 'system-ui, sans-serif'), `family ${k} added`);
          }}
        >
          + 添加字体族
        </button>
      </div>
      <div className="dsgroup">
        <h3>字体文件</h3>
        {t.fonts.map((f) => (
          <div key={f.file} className="kv">
            <span style={{ fontFamily: `"${f.family}"`, fontSize: 20 }}>{f.family}</span>
            <code className="hint">
              {f.file} · {f.weight ?? '400'}
            </code>
          </div>
        ))}
        {t.hosted.map((h) => (
          <div key={h.family} className="kv">
            <span style={{ fontFamily: `"${h.family}"`, fontSize: 20 }}>{h.family}</span>
            <code className="hint">Google Fonts</code>
          </div>
        ))}
        {!t.fonts.length && !t.hosted.length && <p className="hint">没有字体文件；样式用的是系统字体。</p>}
        <button className="btn ghost" onClick={() => fontInput.current?.click()}>
          + 上传字体文件
        </button>
        <input
          ref={fontInput}
          type="file"
          hidden
          accept=".woff2,.woff,.ttf,.otf"
          onChange={async (e) => {
            const files = e.currentTarget.files;
            if (!files?.length) return;
            await addFonts(files);
            e.currentTarget.value = '';
          }}
        />
      </div>
    </section>
  );
}

// ----------------------------------------------------------- other families

const KEY_ZH: Record<string, string> = { spacing: '间距', radius: '圆角', shadow: '阴影' };

export function FamiliesView({ t, theme }: { t: DsTokens; theme: string }) {
  const keys = ['spacing', 'radius', 'shadow', ...t.others.map((f) => f.key).filter((k) => !['spacing', 'radius', 'shadow'].includes(k))];
  return (
    <section className="dsview" aria-label="间距、圆角与阴影">
      <header>
        <h2>间距、圆角与阴影</h2>
      </header>
      {keys.map((key) => {
        const fam = t.others.find((f) => f.key === key);
        const tokens = fam?.tokens ?? [];
        const set = (name: string, field: 'value' | 'usage', v: string) =>
          editTokens((json) => {
            const tok = familyList(json, key).find((x) => x.name === name);
            if (!tok) return;
            if (field === 'value' && key === 'shadow' && tok.value && typeof tok.value === 'object') (tok.value as Record<string, string>)[theme] = v;
            else tok[field] = v || (field === 'usage' ? undefined : v);
          }, `${key} ${name} ${field}`);
        return (
          <div key={key} className="dsgroup" data-family={key}>
            <h3>{KEY_ZH[key] ?? fam?.title ?? key}</h3>
            {fam?.note && <p className="hint">{fam.note}</p>}
            {tokens.map((x) => {
              const v = x.values?.[theme] ?? x.value;
              return (
                <div key={x.name} className="famrow">
                  <span className="vis">
                    {key === 'spacing' ? (
                      <span className="sbar" style={{ width: v }} />
                    ) : key === 'radius' ? (
                      <span className="rad" style={{ borderRadius: v }} />
                    ) : key === 'shadow' ? (
                      <span className="shd" style={{ boxShadow: v }} />
                    ) : null}
                  </span>
                  <code className="nm">{x.name}</code>
                  <TextInput value={v} label={`${x.name} 的值`} mono onCommit={(nv) => set(x.name, 'value', nv.trim())} />
                  <TextInput value={x.usage ?? ''} label={`${x.name} 的用法`} placeholder="用法" onCommit={(nv) => set(x.name, 'usage', nv.trim())} />
                  <button className="ib" aria-label={`删除 ${x.name}`} title="删除" onClick={() => editTokens((json) => {
                    const l = familyList(json, key);
                    l.splice(l.findIndex((y) => y.name === x.name), 1);
                  }, `${key} ${x.name} removed`)}>
                    ×
                  </button>
                </div>
              );
            })}
            <button
              className="btn ghost"
              onClick={() => {
                const name = unique(t, key === 'spacing' ? 'space' : key);
                editTokens((json) => void familyList(json, key).push({ name, value: key === 'shadow' ? '0 2px 8px rgba(0,0,0,0.12)' : key === 'spacing' || key === 'radius' ? '8px' : '1', usage: '' }), `${key} ${name} added`);
              }}
            >
              + 添加
            </button>
          </div>
        );
      })}
    </section>
  );
}
