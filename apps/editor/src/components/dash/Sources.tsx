import { useEffect, useMemo, useState } from 'react';
import {
  cellText,
  paramsIn,
  parseWhere,
  resolveMark,
  tableToCsv,
  type CalcInfo,
  type DataState,
  type DatasetJson,
  type FileSource,
  type QuerySource,
} from '@dc/core';
import { ago, editDataset, load, pauseQuery, postFrame, rawUrl, resumeQuery, runQuery, staleOf, useDash, useDatasets, type DatasetEntry } from '../../dash';
import { toast } from '../../store';

const STATUS_ZH: Record<string, string> = {
  ok: '已加载',
  loading: '加载中',
  error: '没加载上',
  connect: '连接不可用',
  declined: '已关闭',
  missing: '不存在',
};

function Dot({ s }: { s: DataState | undefined }) {
  const st = !s ? 'idle' : s.status === 'ok' ? (s.refreshing ? 'loading' : 'ok') : s.status;
  return <span className={`sdot ${st}`} aria-label={s ? STATUS_ZH[s.status] : '未读取'} />;
}

const NO_LOADERS: { id: string; description?: string; fn: string }[] = [];

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function download(name: string, text: string, type = 'text/csv'): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** The rows of a result, the picked cell lit. */
function ResultTable({ s, rows: lit, field }: { s: DataState; rows?: number[]; field?: string }) {
  const [all, setAll] = useState(false);
  if (s.status !== 'ok') return <p className="hint">{s.message ?? STATUS_ZH[s.status]}</p>;
  if (!s.columns.length) {
    return <pre className="code sval">{JSON.stringify(s.data, null, 2)?.slice(0, 20000)}</pre>;
  }
  const shown = all ? s.rows : s.rows.slice(0, 100);
  return (
    <>
      <div className="stable">
        <table>
          <thead>
            <tr>
              <th className="n">#</th>
              {s.columns.map((c) => (
                <th key={c} className={c === field ? 'lit' : undefined}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className={lit?.includes(i) ? 'lit' : undefined}>
                <td className="n">{i}</td>
                {s.columns.map((c) => (
                  <td key={c} className={lit?.includes(i) && c === field ? 'cell' : undefined}>
                    {r[c] === null || r[c] === undefined ? <span className="null">null</span> : cellText(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        {s.rows.length} 行{s.cut ? '（被截断）' : ''}
        {s.rows.length > 100 && !all && (
          <button className="linkish" onClick={() => setAll(true)}>
            显示全部
          </button>
        )}
      </p>
      {s.meta.length > 0 && (
        <dl className="smeta">
          {s.meta.map((m, i) => (
            <div key={i}>
              <dt>{m.label}</dt>
              <dd>{m.type === 'code' ? <pre className="code">{m.value}</pre> : m.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

function Chips({ text }: { text: string }) {
  const params = useDash((s) => s.params);
  const parts = text.split(/(\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\})/);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/.exec(p);
        if (!m) return p;
        const v = params[m[1]];
        return (
          <span key={i} className="pchip" title={`筛选 ${m[1]}`}>
            {m[1]} = {v === undefined || v === null ? 'NULL' : JSON.stringify(v)}
          </span>
        );
      })}
    </>
  );
}

/** Edit a live query's arguments: test without saving, then save. */
function EditQuery({ id, q, onDone }: { id: string; q: QuerySource; onDone: () => void }) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(q.args).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])),
  );
  const [test, setTest] = useState<string | null>(null);
  const params = useDash((s) => s.params);
  const args = () => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft)) {
      if (v.length > 16000) throw new Error(`${k} 超过 16000 个字符`);
      if (typeof q.args[k] === 'string') out[k] = v;
      else {
        try {
          out[k] = JSON.parse(v);
        } catch {
          throw new Error(`${k} 不是合法的 JSON`);
        }
      }
    }
    return out;
  };
  return (
    <div className="seditq">
      {Object.keys(draft).map((k) => (
        <label key={k}>
          <span>{k}</span>
          <textarea className="code" spellCheck={false} rows={k === 'sql' ? 8 : 2} value={draft[k]} aria-label={`参数 ${k}`} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        </label>
      ))}
      {test && <p className={`hint ${test.startsWith('✓') ? 'okline' : 'badline'}`}>{test}</p>}
      <div className="row">
        <button className="btn ghost" onClick={onDone}>
          取消
        </button>
        <button
          className="btn ghost"
          onClick={async () => {
            try {
              setTest('运行中…');
              const r = await runQuery({ ...q, args: args() }, params);
              if (!r.ok) return setTest(`✗ ${r.message}`);
              const rows = Array.isArray((r.answer as { rows?: unknown[] })?.rows) ? (r.answer as { rows: unknown[] }).rows.length : Array.isArray(r.answer) ? r.answer.length : null;
              setTest(`✓ 成功${rows !== null ? `，${rows} 行` : ''}，${r.ms} ms`);
            } catch (e) {
              setTest(`✗ ${(e as Error).message}`);
            }
          }}
        >
          试运行
        </button>
        <button
          className="btn primary"
          onClick={() => {
            try {
              const a = args();
              editDataset(id, (d) => ({ ...d, source: { ...(d.source as QuerySource), args: a } }), `${id}: query edited`);
              onDone();
            } catch (e) {
              toast((e as Error).message, 'error');
            }
          }}
        >
          保存
        </button>
      </div>
    </div>
  );
}

function DatasetView({ entry }: { entry: DatasetEntry }) {
  const d = entry.dataset;
  const s = useDash((st) => st.derived[entry.id] ?? st.states[entry.id]);
  const pick = useDash((st) => st.pick);
  const loaders = useDash((st) => st.report?.loaders ?? NO_LOADERS);
  const [editing, setEditing] = useState(false);
  const loader = loaders.find((l) => l.id === entry.id);
  const picked = pick && pick.sources[0] === entry.id ? pick : null;
  const lit = useMemo(() => {
    if (!picked || !s || s.status !== 'ok') return undefined;
    const r = resolveMark({ source: entry.id, field: picked.field, where: picked.where !== undefined ? parseWhere(picked.where) : undefined, row: picked.row }, { columns: s.columns, rows: s.rows });
    return typeof r === 'string' ? undefined : r;
  }, [picked, s, entry.id]);
  if (!d) return <p className="hint badline">{entry.error}</p>;
  const src = d.source;
  const cellValue = picked?.field && lit?.length === 1 && s ? s.rows[lit[0]][picked.field] : undefined;
  return (
    <>
      <h2>{d.title || entry.id}</h2>
      {d.description && <p className="sdesc">{d.description}</p>}
      {entry.error && <p className="hint badline">{entry.error}</p>}
      {picked?.field && lit?.length === 1 && (
        <div className="scard">
          <div className="hint">{picked.field}</div>
          <div className="big">{cellText(cellValue)}</div>
          {picked.shown && picked.shown !== cellText(cellValue) && <div className="hint">页面上显示为 {picked.shown}</div>}
        </div>
      )}
      {s && s.status !== 'ok' && s.status !== 'loading' && <p className="hint badline">{s.message ?? STATUS_ZH[s.status]}</p>}
      {staleOf(d) && <p className="hint warnline">数据过期了：上次更新在 {ago(d.updated?.at)}，超过 {d.staleAfterHours} 小时。</p>}
      {src.kind === 'query' && (
        <details open>
          <summary>查询</summary>
          {editing ? (
            <EditQuery id={entry.id} q={src as QuerySource} onDone={() => setEditing(false)} />
          ) : (
            <>
              {Object.entries((src as QuerySource).args).map(([k, v]) => (
                <div key={k} className="sarg">
                  <span className="hint">{k}</span>
                  <pre className="code">
                    <Chips text={typeof v === 'string' ? v : JSON.stringify(v)} />
                  </pre>
                </div>
              ))}
              <p className="hint">
                {(src as QuerySource).connector} · {(src as QuerySource).tool}
              </p>
              <div className="row">
                <button className="btn ghost" onClick={() => setEditing(true)}>
                  编辑查询
                </button>
                <button className="btn ghost" onClick={() => void load(entry.id, true)}>
                  刷新
                </button>
                <button
                  className="btn ghost"
                  disabled={paramsIn((src as QuerySource).args).length > 0}
                  title={paramsIn((src as QuerySource).args).length ? '随筛选变化的查询只能保持实时' : '把现在的结果存成文件：读者不再运行查询'}
                  onClick={() => void pauseQuery(entry.id).catch((e) => toast(e.message, 'error'))}
                >
                  停止自动刷新
                </button>
              </div>
            </>
          )}
        </details>
      )}
      {src.kind === 'file' && (
        <details open>
          <summary>{d.request ? '查询（不自动刷新）' : '文件'}</summary>
          {d.request && (
            <>
              <p className="hint">这是一份保存下来的查询结果：大家看到的是同一份行，查询不会再运行。</p>
              <pre className="code">
                <Chips text={String(d.request.args.sql ?? JSON.stringify(d.request.args))} />
              </pre>
              <div className="row">
                <button className="btn ghost" onClick={() => resumeQuery(entry.id)}>
                  恢复实时查询
                </button>
              </div>
            </>
          )}
          <p className="hint">
            <a href={rawUrl((src as FileSource).url.replace(/^\.?\//, ''))} target="_blank" rel="noreferrer">
              {(src as FileSource).name || (src as FileSource).url}
            </a>
            {d.updated?.at ? ` · 更新于 ${ago(d.updated.at)}${d.updated.by ? `（${d.updated.by}）` : ''}` : ' · 没写 updated'}
          </p>
          {d.schedule && <p className="hint">更新方式：{d.schedule}</p>}
          {d.lastAttempt && !d.lastAttempt.ok && <p className="hint badline">上次刷新失败：{d.lastAttempt.error}</p>}
        </details>
      )}
      {loader && (
        <details>
          <summary>转换</summary>
          {loader.description && <p className="hint">{loader.description}</p>}
          <pre className="code">{loader.fn}</pre>
        </details>
      )}
      <details open>
        <summary>结果</summary>
        {s ? <ResultTable s={s} rows={lit} field={picked?.field} /> : <p className="hint">页面还没读这个来源。</p>}
        {s?.status === 'ok' && s.columns.length > 0 && (
          <button className="btn ghost" onClick={() => download(`${entry.id}.csv`, tableToCsv({ columns: s.columns, rows: s.rows }))}>
            下载 CSV
          </button>
        )}
      </details>
    </>
  );
}

function CalcView({ c }: { c: CalcInfo }) {
  const s = useDash((st) => st.derived[c.id]);
  const pick = useDash((st) => st.pick);
  const picked = pick && pick.sources[0] === c.id ? pick : null;
  const lit = useMemo(() => {
    if (!picked || !s || s.status !== 'ok' || !s.columns.length) return undefined;
    const r = resolveMark({ source: c.id, field: picked.field, where: picked.where !== undefined ? parseWhere(picked.where) : undefined, row: picked.row }, { columns: s.columns, rows: s.rows });
    return typeof r === 'string' ? undefined : r;
  }, [picked, s, c.id]);
  return (
    <>
      <h2>{c.title || c.id}</h2>
      {c.description && <p className="sdesc">{c.description}</p>}
      {picked?.field && lit?.length === 1 && s && (
        <div className="scard">
          <div className="hint">{picked.field}</div>
          <div className="big">{cellText(s.rows[lit[0]][picked.field])}</div>
        </div>
      )}
      <details open>
        <summary>公式</summary>
        <p className="hint">输入：{c.inputs.join('、')}</p>
        <pre className="code">{c.fn}</pre>
      </details>
      <details open>
        <summary>结果</summary>
        {s ? <ResultTable s={s} rows={lit} field={picked?.field} /> : <p className="hint">还没算。</p>}
      </details>
    </>
  );
}

function Problems() {
  const report = useDash((s) => s.report);
  const states = useDash((s) => s.states);
  const datasets = useDatasets();
  const failed = Object.entries(states).filter(([, s]) => s.status === 'error' || s.status === 'connect' || s.status === 'missing');
  const broken = datasets.filter((d) => d.error);
  if (!report?.marks.length && !report?.errors.length && !failed.length && !broken.length) return null;
  return (
    <section className="sproblems" aria-label="问题">
      <h3>问题</h3>
      <ul className="issue-list">
        {broken.map((d) => (
          <li key={'b' + d.id} className="error">
            <code>{d.path}</code> {d.error}
          </li>
        ))}
        {failed.map(([id, s]) => (
          <li key={'f' + id} className="error">
            <button className="linkish" onClick={() => useDash.setState({ open: id, pick: null })}>
              {id}
            </button>{' '}
            没加载上：{s.message}
          </li>
        ))}
        {report?.errors.map((e, i) => (
          <li key={'e' + i} className="error">
            页面代码{e.kind === 'stopped' ? '停止了' : e.kind === 'rejection' ? '有未处理的 Promise 失败' : '出错了'}
            {e.file ? `（${e.file}）` : ''}：{e.name}: {e.message}
            {e.count > 1 ? ` ×${e.count}` : ''}
          </li>
        ))}
        {report?.marks.map((m, i) => (
          <li key={'m' + i} className="warn">
            <code>{m.mark}</code> {m.source}
            {m.field ? ` · ${m.field}` : ''}
            {m.where ? ` · ${safeDecode(m.where)}` : m.row !== undefined ? ` · 第 ${m.row} 行` : ''}：
            {m.reason ? m.reason : `页面显示 ${m.shown}，数据里是 ${m.inData}`}
          </li>
        ))}
        {report && report.flagged > report.marks.length && <li className="warn">还有 {report.flagged - report.marks.length} 个标注对不上。</li>}
      </ul>
    </section>
  );
}

export function SourcesPanel() {
  const datasets = useDatasets();
  const open = useDash((s) => s.open);
  const report = useDash((s) => s.report);
  const states = useDash((s) => s.states);
  const derived = useDash((s) => s.derived);
  const calcs = report?.calcs ?? [];
  // a dataset only a calc reads is used too
  const used = new Set([...(report?.read ?? []), ...(report?.marked ?? [])]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of calcs) if (used.has(c.id)) for (const i of c.inputs) if (!used.has(i)) used.add(i), (grew = true);
  }
  useEffect(() => {
    postFrame({ dc: 'dash-spot', ids: open ? [open] : [] });
  }, [open]);
  const entry = open ? datasets.find((d) => d.id === open) : undefined;
  const calc = open ? calcs.find((c) => c.id === open) : undefined;
  return (
    <aside className="dashside" aria-label="数据来源">
      {open && (entry || calc) ? (
        <div className="sview">
          <button className="btn ghost" onClick={() => useDash.setState({ open: null, pick: null })}>
            ← 所有来源
          </button>
          {entry ? <DatasetView entry={entry} /> : <CalcView c={calc!} />}
        </div>
      ) : (
        <>
          <h3>数据来源</h3>
          {!datasets.length && <p className="hint">还没有数据。把 CSV、JSON 或 SQLite 文件放进 data/，在 datasets/ 里写一份说明，或者让 Claude Code 来做。</p>}
          <ul className="slist">
            {datasets.map((d) => {
              const s = states[d.id];
              const src = d.dataset?.source as { kind?: string; connector?: string } | undefined;
              return (
                <li key={d.id}>
                  <button
                    className="srow"
                    data-source={d.id}
                    onClick={() => useDash.setState({ open: d.id, pick: null })}
                    onMouseEnter={() => postFrame({ dc: 'dash-spot', ids: [d.id] })}
                    onMouseLeave={() => postFrame({ dc: 'dash-spot', ids: open ? [open] : [] })}
                    title={src?.kind === 'query' ? `${src.connector} · ${ago(s?.at)}` : ago(d.dataset?.updated?.at ?? s?.at)}
                  >
                    <Dot s={s} />
                    <span className="sname">{d.dataset?.title || d.id}</span>
                    {report && !used.has(d.id) && <span className="tag">未使用</span>}
                    {staleOf(d.dataset as DatasetJson) && <span className="tag warn">过期</span>}
                    {d.dataset?.request && <span className="tag">不自动刷新</span>}
                    <span className="meta">{src?.kind === 'query' ? '查询' : '文件'}{s?.status === 'ok' && s.columns.length ? ` · ${s.rows.length} 行` : ''}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {calcs.length > 0 && (
            <>
              <h3>计算</h3>
              <ul className="slist">
                {calcs.map((c) => (
                  <li key={c.id}>
                    <button className="srow" data-source={c.id} onClick={() => useDash.setState({ open: c.id, pick: null })} onMouseEnter={() => postFrame({ dc: 'dash-spot', ids: [c.id] })} onMouseLeave={() => postFrame({ dc: 'dash-spot', ids: [] })}>
                      <Dot s={derived[c.id]} />
                      <span className="sname">{c.title || c.id}</span>
                      <span className="meta">由 {c.inputs.join('、')} 算出</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Problems />
        </>
      )}
    </aside>
  );
}
