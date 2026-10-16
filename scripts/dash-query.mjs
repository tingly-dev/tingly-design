#!/usr/bin/env node
// Look into a dashboard's SQLite database, read only:
//   node scripts/dash-query.mjs projects/<dash>/data/<db> "SELECT …"
//   node scripts/dash-query.mjs projects/<dash>/data/<db>            (lists tables and columns)
// The projects folder is DC_PROJECTS when the server runs with one (a host's data folder);
// a dashboard linked from elsewhere on disk (listed in its .links.json) is read where it is.
// Prints the rows as JSON (at most 200), or the error.
import { readFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

process.removeAllListeners('warning');
const { DatabaseSync } = await import('node:sqlite');
const [db, sql] = process.argv.slice(2);
const root = resolve(process.env.DC_PROJECTS ?? resolve(import.meta.dirname, '..', 'projects'));
const path = resolve(db ?? '');
const roots = [root];
try {
  roots.push(...Object.values(JSON.parse(readFileSync(join(root, '.links.json'), 'utf8'))).filter((d) => typeof d === 'string'));
} catch {
  // no linked projects
}
const inside = roots.some((r) => !relative(r, path).startsWith('..'));
if (!db || !inside || !/[\\/]data[\\/][^\\/]+\.(db|sqlite3?)$/.test(path)) {
  console.error(`usage: node scripts/dash-query.mjs ${relative(process.cwd(), root) || '.'}/<dashboard>/data/<file>.db ["SELECT …"]`);
  process.exit(2);
}
const conn = new DatabaseSync(path, { readOnly: true });
try {
  if (!sql) {
    for (const { name } of conn.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").all()) {
      const cols = conn.prepare('SELECT name, type FROM pragma_table_info(?)').all(name).map((c) => `${c.name} ${c.type}`.trim());
      const n = conn.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get().n;
      console.log(`${name} (${n} rows): ${cols.join(', ')}`);
    }
  } else {
    if (!/^\s*(select|with)\b/i.test(sql)) throw new Error('one SELECT or WITH statement');
    const rows = conn.prepare(sql).all();
    console.log(JSON.stringify(rows.slice(0, 200), (_, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
    if (rows.length > 200) console.log(`… ${rows.length} rows in all`);
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  conn.close();
}
