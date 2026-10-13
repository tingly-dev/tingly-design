import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

function Dot({ s }: { s: DataState | undefined }) {
  const { t } = useTranslation();
  const st = !s ? 'idle' : s.status === 'ok' ? (s.refreshing ? 'loading' : 'ok') : s.status;
  return <span className={`sdot ${st}`} aria-label={t(`dash.status.${s ? s.status : 'idle'}`)} />;
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
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  if (s.status !== 'ok') return <p className="hint">{s.message ?? t(`dash.status.${s.status}`)}</p>;
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
        {t(s.cut ? 'dash.result.rowsCut' : 'dash.result.rows', { count: s.rows.length })}
        {s.rows.length > 100 && !all && (
          <button className="linkish" onClick={() => setAll(true)}>
            {t('dash.result.showAll')}
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
  const { t } = useTranslation();
  const params = useDash((s) => s.params);
  const parts = text.split(/(\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\})/);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/.exec(p);
        if (!m) return p;
        const v = params[m[1]];
        return (
          <span key={i} className="pchip" title={t('dash.dataset.filterChip', { name: m[1] })}>
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
  const { t } = useTranslation();
  const [test, setTest] = useState<string | null>(null);
  const params = useDash((s) => s.params);
  const args = () => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft)) {
      if (v.length > 16000) throw new Error(t('dash.editQuery.tooLong', { key: k }));
      if (typeof q.args[k] === 'string') out[k] = v;
      else {
        try {
          out[k] = JSON.parse(v);
        } catch {
          throw new Error(t('dash.editQuery.badJson', { key: k }));
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
          <textarea className="code" spellCheck={false} rows={k === 'sql' ? 8 : 2} value={draft[k]} aria-label={t('dash.editQuery.argLabel', { key: k })} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        </label>
      ))}
      {test && <p className={`hint ${test.startsWith('✓') ? 'okline' : 'badline'}`}>{test}</p>}
      <div className="row">
        <button className="btn ghost" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button
          className="btn ghost"
          onClick={async () => {
            try {
              setTest(t('dash.editQuery.running'));
              const r = await runQuery({ ...q, args: args() }, params);
              if (!r.ok) return setTest(`✗ ${r.message}`);
              const rows = Array.isArray((r.answer as { rows?: unknown[] })?.rows) ? (r.answer as { rows: unknown[] }).rows.length : Array.isArray(r.answer) ? r.answer.length : null;
              setTest(rows !== null ? t('dash.editQuery.ok', { count: rows, ms: r.ms }) : t('dash.editQuery.okNoRows', { ms: r.ms }));
            } catch (e) {
              setTest(`✗ ${(e as Error).message}`);
            }
          }}
        >
          {t('dash.editQuery.test')}
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
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

function DatasetView({ entry }: { entry: DatasetEntry }) {
  const { t } = useTranslation();
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
          {picked.shown && picked.shown !== cellText(cellValue) && <div className="hint">{t('dash.dataset.shownAs', { value: picked.shown })}</div>}
        </div>
      )}
      {s && s.status !== 'ok' && s.status !== 'loading' && <p className="hint badline">{s.message ?? t(`dash.status.${s.status}`)}</p>}
      {staleOf(d) && <p className="hint warnline">{t('dash.dataset.stale', { ago: ago(d.updated?.at, t), hours: d.staleAfterHours })}</p>}
      {src.kind === 'query' && (
        <details open>
          <summary>{t('dash.sources.query')}</summary>
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
                  {t('dash.dataset.editQuery')}
                </button>
                <button className="btn ghost" onClick={() => void load(entry.id, true)}>
                  {t('dash.bar.refresh')}
                </button>
                <button
                  className="btn ghost"
                  disabled={paramsIn((src as QuerySource).args).length > 0}
                  title={paramsIn((src as QuerySource).args).length ? t('dash.dataset.pauseTitleLive') : t('dash.dataset.pauseTitle')}
                  onClick={() => void pauseQuery(entry.id).catch((e) => toast(e.message, 'error'))}
                >
                  {t('dash.dataset.pause')}
                </button>
              </div>
            </>
          )}
        </details>
      )}
      {src.kind === 'file' && (
        <details open>
          <summary>{d.request ? t('dash.dataset.queryPaused') : t('dash.sources.file')}</summary>
          {d.request && (
            <>
              <p className="hint">{t('dash.dataset.savedHint')}</p>
              <pre className="code">
                <Chips text={String(d.request.args.sql ?? JSON.stringify(d.request.args))} />
              </pre>
              <div className="row">
                <button className="btn ghost" onClick={() => resumeQuery(entry.id)}>
                  {t('dash.dataset.resume')}
                </button>
              </div>
            </>
          )}
          <p className="hint">
            <a href={rawUrl((src as FileSource).url.replace(/^\.?\//, ''))} target="_blank" rel="noreferrer">
              {(src as FileSource).name || (src as FileSource).url}
            </a>
            {' · '}
            {d.updated?.at
              ? d.updated.by
                ? t('dash.dataset.updatedBy', { ago: ago(d.updated.at, t), by: d.updated.by })
                : t('dash.dataset.updated', { ago: ago(d.updated.at, t) })
              : t('dash.dataset.noUpdated')}
          </p>
          {d.schedule && <p className="hint">{t('dash.dataset.schedule', { schedule: d.schedule })}</p>}
          {d.lastAttempt && !d.lastAttempt.ok && <p className="hint badline">{t('dash.dataset.lastFailed', { error: d.lastAttempt.error })}</p>}
        </details>
      )}
      {loader && (
        <details>
          <summary>{t('dash.dataset.transform')}</summary>
          {loader.description && <p className="hint">{loader.description}</p>}
          <pre className="code">{loader.fn}</pre>
        </details>
      )}
      <details open>
        <summary>{t('dash.result.title')}</summary>
        {s ? <ResultTable s={s} rows={lit} field={picked?.field} /> : <p className="hint">{t('dash.result.notRead')}</p>}
        {s?.status === 'ok' && s.columns.length > 0 && (
          <button className="btn ghost" onClick={() => download(`${entry.id}.csv`, tableToCsv({ columns: s.columns, rows: s.rows }))}>
            {t('dash.result.downloadCsv')}
          </button>
        )}
      </details>
    </>
  );
}

function CalcView({ c }: { c: CalcInfo }) {
  const { t } = useTranslation();
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
        <summary>{t('dash.dataset.formula')}</summary>
        <p className="hint">{t('dash.dataset.inputs', { list: c.inputs.join(t('dash.listSep')) })}</p>
        <pre className="code">{c.fn}</pre>
      </details>
      <details open>
        <summary>{t('dash.result.title')}</summary>
        {s ? <ResultTable s={s} rows={lit} field={picked?.field} /> : <p className="hint">{t('dash.result.notComputed')}</p>}
      </details>
    </>
  );
}

function Problems() {
  const { t } = useTranslation();
  const report = useDash((s) => s.report);
  const states = useDash((s) => s.states);
  const datasets = useDatasets();
  const failed = Object.entries(states).filter(([, s]) => s.status === 'error' || s.status === 'connect' || s.status === 'missing');
  const broken = datasets.filter((d) => d.error);
  if (!report?.marks.length && !report?.errors.length && !failed.length && !broken.length) return null;
  return (
    <section className="sproblems" aria-label={t('dash.problems.title')}>
      <h3>{t('dash.problems.title')}</h3>
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
            {t('dash.problems.failed', { message: s.message })}
          </li>
        ))}
        {report?.errors.map((e, i) => (
          <li key={'e' + i} className="error">
            {t(`dash.problems.${e.kind === 'stopped' ? 'stopped' : e.kind === 'rejection' ? 'rejection' : 'error'}${e.file ? 'In' : ''}`, { file: e.file, error: `${e.name}: ${e.message}` })}
            {e.count > 1 ? ` ×${e.count}` : ''}
          </li>
        ))}
        {report?.marks.map((m, i) => (
          <li key={'m' + i} className="warn">
            <code>{m.mark}</code> {m.source}
            {m.field ? ` · ${m.field}` : ''}
            {m.where ? ` · ${safeDecode(m.where)}` : m.row !== undefined ? ` · ${t('dash.problems.row', { row: m.row })}` : ''}
            {m.reason ? t('dash.problems.reason', { reason: m.reason }) : t('dash.problems.mismatch', { shown: m.shown, inData: m.inData })}
          </li>
        ))}
        {report && report.flagged > report.marks.length && <li className="warn">{t('dash.problems.moreMarks', { count: report.flagged - report.marks.length })}</li>}
      </ul>
    </section>
  );
}

export function SourcesPanel() {
  const { t } = useTranslation();
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
    <aside className="dashside" aria-label={t('dash.sources.label')}>
      {open && (entry || calc) ? (
        <div className="sview">
          <button className="btn ghost" onClick={() => useDash.setState({ open: null, pick: null })}>
            {t('dash.sources.back')}
          </button>
          {entry ? <DatasetView entry={entry} /> : <CalcView c={calc!} />}
        </div>
      ) : (
        <>
          <h3>{t('dash.sources.label')}</h3>
          {!datasets.length && <p className="hint">{t('dash.sources.empty')}</p>}
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
                    title={src?.kind === 'query' ? `${src.connector} · ${ago(s?.at, t)}` : ago(d.dataset?.updated?.at ?? s?.at, t)}
                  >
                    <Dot s={s} />
                    <span className="sname">{d.dataset?.title || d.id}</span>
                    {report && !used.has(d.id) && <span className="tag">{t('dash.sources.unused')}</span>}
                    {staleOf(d.dataset as DatasetJson) && <span className="tag warn">{t('dash.sources.stale')}</span>}
                    {d.dataset?.request && <span className="tag">{t('dash.sources.paused')}</span>}
                    <span className="meta">
                      {src?.kind === 'query' ? t('dash.sources.query') : t('dash.sources.file')}
                      {s?.status === 'ok' && s.columns.length ? ` · ${t('dash.result.rows', { count: s.rows.length })}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {calcs.length > 0 && (
            <>
              <h3>{t('dash.sources.calcs')}</h3>
              <ul className="slist">
                {calcs.map((c) => (
                  <li key={c.id}>
                    <button className="srow" data-source={c.id} onClick={() => useDash.setState({ open: c.id, pick: null })} onMouseEnter={() => postFrame({ dc: 'dash-spot', ids: [c.id] })} onMouseLeave={() => postFrame({ dc: 'dash-spot', ids: [] })}>
                      <Dot s={derived[c.id]} />
                      <span className="sname">{c.title || c.id}</span>
                      <span className="meta">{t('dash.sources.computedFrom', { list: c.inputs.join(t('dash.listSep')) })}</span>
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
