import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DASH_DATA_MAX, bindSql, isDatabasePath, type Params } from '@dc/core';
import { projectDir } from './store';

/**
 * Where a dashboard's live queries go. The original calls a tool of an MCP
 * connector on each reader's own connection; here a connector is a small
 * module of this server, each with the tools a dataset may name. A tool
 * answers with what the original's would: rows (`{columns, rows}`), or
 * anything else for a loader to reshape.
 *
 * Failures carry the state the page shows: `failed` (the query is wrong:
 * Claude's to fix), `refused` (the SQL breaks the read-only rules),
 * `absent` (no such connector or tool here).
 */
export class ConnectorError extends Error {
  constructor(
    public state: 'failed' | 'refused' | 'absent',
    message: string,
  ) {
    super(message);
  }
}

export interface Connector {
  description: string;
  tools: Record<string, (project: string, args: Record<string, unknown>, params: Params) => Promise<unknown>>;
}

const ROW_CAP = 200_000;

type SqliteModule = typeof import('node:sqlite');
let sqlite: SqliteModule | null = null;
async function loadSqlite(): Promise<SqliteModule> {
  if (sqlite) return sqlite;
  // node:sqlite prints an ExperimentalWarning once; keep it out of the log
  const emit = process.emitWarning;
  process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
    if (String(typeof w === 'string' ? w : w.message).includes('SQLite')) return;
    (emit as (...a: unknown[]) => void).call(process, w, ...rest);
  }) as typeof process.emitWarning;
  try {
    sqlite = await import('node:sqlite');
  } finally {
    process.emitWarning = emit;
  }
  return sqlite;
}

/** A SQLite database under the project's data/, opened read only. */
const sqliteConnector: Connector = {
  description: 'SQLite databases under data/ (args: {db: "data/x.db", sql})',
  tools: {
    async query(project, args, params) {
      const db = typeof args.db === 'string' ? args.db.replace(/^\.?\//, '') : '';
      if (!isDatabasePath(db)) throw new ConnectorError('failed', `args.db names a database under data/ (.db, .sqlite), not ${JSON.stringify(args.db)}`);
      const path = join(projectDir(project), db);
      try {
        await stat(path);
      } catch {
        throw new ConnectorError('failed', `no database ${db}`);
      }
      const bound = bindSql(String(args.sql ?? ''), params);
      if ('error' in bound) throw new ConnectorError('refused', bound.error);
      const { DatabaseSync } = await loadSqlite();
      const conn = new DatabaseSync(path, { readOnly: true });
      try {
        const st = conn.prepare(bound.sql.replace(/;\s*$/, ''));
        const columns = st.columns().map((c) => c.name);
        const rows: Record<string, unknown>[] = [];
        let size = 0;
        let cut = false;
        for (const r of st.iterate(...bound.values)) {
          const row = { ...(r as Record<string, unknown>) };
          for (const k of Object.keys(row)) if (typeof row[k] === 'bigint') row[k] = Number(row[k]);
          size += JSON.stringify(row).length;
          if (size > DASH_DATA_MAX) throw new ConnectorError('failed', 'the result is over 8 MB: aggregate in SQL, or ask for fewer columns and rows');
          if (rows.length >= ROW_CAP) {
            cut = true;
            break;
          }
          rows.push(row);
        }
        return cut ? { columns, rows, cut } : { columns, rows };
      } catch (e) {
        if (e instanceof ConnectorError) throw e;
        throw new ConnectorError('failed', (e as Error).message);
      } finally {
        conn.close();
      }
    },
    /** The tables and their columns, for finding the data (not for a page). */
    async schema(project, args) {
      const db = typeof args.db === 'string' ? args.db.replace(/^\.?\//, '') : '';
      if (!isDatabasePath(db)) throw new ConnectorError('failed', 'args.db names a database under data/');
      const { DatabaseSync } = await loadSqlite();
      const conn = new DatabaseSync(join(projectDir(project), db), { readOnly: true });
      try {
        const tables = conn.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").all() as { name: string }[];
        return tables.map((t) => ({
          table: t.name,
          columns: (conn.prepare(`SELECT name, type FROM pragma_table_info(?)`).all(t.name) as { name: string; type: string }[]).map((c) => `${c.name} ${c.type}`.trim()).join(', '),
        }));
      } catch (e) {
        throw new ConnectorError('failed', (e as Error).message);
      } finally {
        conn.close();
      }
    },
  },
};

export const CONNECTORS: Record<string, Connector> = { sqlite: sqliteConnector };

export async function callTool(project: string, connector: string, tool: string, args: Record<string, unknown>, params: Params): Promise<unknown> {
  const c = CONNECTORS[connector];
  if (!c) throw new ConnectorError('absent', `${connector} is not a connector of this server (there is ${Object.keys(CONNECTORS).join(', ')})`);
  const fn = Object.hasOwn(c.tools, tool) ? c.tools[tool] : undefined;
  if (!fn) throw new ConnectorError('absent', `${connector} has no tool ${tool} (it has ${Object.keys(c.tools).join(', ')})`);
  return fn(project, args, params);
}
