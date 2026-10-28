/**
 * Which package may import which (docs/en/architecture.md): the arrows only go one way.
 *   export, i18n      import no other package
 *   core              imports no other package
 *   import            core, i18n
 *   sandbox           core, export
 *   server            core, export, i18n
 *   editor            core, export, i18n, import
 * Nothing imports sandbox: it is used as its built IIFEs. Tests are not checked.
 * `pnpm depcheck` runs it; CI fails on a new arrow.
 * core keeps its single barrel (`src/index.ts`): the bundlers tree-shake it, and subpath
 * exports would give the same file two import paths, hence two module instances.
 */
const sources = ['apps/editor', 'apps/server', 'packages/core', 'packages/export', 'packages/i18n', 'packages/import', 'packages/sandbox'];
const allowed = {
  'apps/editor': ['packages/core', 'packages/export', 'packages/i18n', 'packages/import'],
  'apps/server': ['packages/core', 'packages/export', 'packages/i18n'],
  'packages/core': [],
  'packages/export': [],
  'packages/i18n': [],
  'packages/import': ['packages/core', 'packages/i18n'],
  'packages/sandbox': ['packages/core', 'packages/export'],
};

module.exports = {
  forbidden: sources.map((from) => ({
    name: `${from.replace('/', '-')}-imports`,
    severity: 'error',
    comment: `${from} may import only: ${allowed[from].join(', ') || 'no other package'}`,
    from: { path: `^${from}/` },
    // a package that is not declared does not resolve (pnpm), so its `@dc/…` name is matched too
    to: {
      path: `^((${sources.filter((s) => s !== from && !allowed[from].includes(s)).join('|')})/|@dc/(${sources
        .filter((s) => s !== from && !allowed[from].includes(s) && s.startsWith('packages/'))
        .map((s) => s.slice('packages/'.length))
        .join('|') || '-'})(/|$))`,
    },
  })),
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    exclude: { path: ['/node_modules/', '/dist/', '/test/', '\\.test\\.ts$'] },
  },
};
