#!/usr/bin/env node
// Build the folder a host ships and runs: dist/tingly-design/
//
//   cli.mjs              the `tingly-design` command with every dependency bundled in (the package's bin)
//   server.mjs           what a host runs, `node server.mjs`: the same as `tingly-design serve`
//   tingly-design.json   name, version, protocol, entry and the Node it needs
//   editor/  sandbox/    the built editor and the artboard runtime
//   samples/             the sample projects, copied into a projects folder that does not exist yet
//   scripts/  .claude/   what Claude Code reads and runs when work is handed to it
//   package.json         the npm package @tingly-dev/tingly-design; README, LICENSE and NOTICE (when the repo has them),
//                        THIRD_PARTY_LICENSES (the notices of every dependency bundled in) beside it
//
// Usage: pnpm bundle   (builds the editor and sandbox first). See docs/en/embedding.md.
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as esbuild from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'dist', 'tingly-design');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const protocol = Number(/export const PROTOCOL = (\d+);/.exec(readFileSync(join(root, 'apps/server/src/layout.ts'), 'utf8'))?.[1]);
if (!protocol) throw new Error('PROTOCOL not found in apps/server/src/layout.ts');

if (!process.argv.includes('--no-build')) execFileSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' });
for (const need of ['apps/editor/dist/index.html', 'packages/sandbox/dist/runtime.js']) {
  if (!existsSync(join(root, need))) throw new Error(`${need} is missing: run pnpm build first`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await esbuild.build({
  entryPoints: [join(root, 'apps/server/src/cli.ts')],
  outfile: join(out, 'cli.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  legalComments: 'none',
  // CommonJS dependencies call require(); give the ES module one
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __dcRequire } from 'node:module'; const require = __dcRequire(import.meta.url);" },
  // chokidar's optional macOS watcher is native; it falls back without it
  external: ['fsevents'],
  logLevel: 'warning',
});

// one copy of the server: a host's `node server.mjs` is `tingly-design serve`, configured by the environment
writeFileSync(
  join(out, 'server.mjs'),
  `// The entry a host runs, configured by the environment (docs/en/embedding.md): the same as \`tingly-design serve\`.\n` +
    `process.argv.splice(2, process.argv.length, 'serve');\nawait import('./cli.mjs');\n`,
);
chmodSync(join(out, 'cli.mjs'), 0o755);

const copy = (from, to, filter) => cpSync(join(root, from), join(out, to), { recursive: true, filter });
copy('apps/editor/dist', 'editor');
copy('packages/sandbox/dist', 'sandbox');
copy('projects', 'samples', (src) => !/[/\\]\.(journal\.jsonl|runs\.json)$/.test(src) && !/[/\\]renders([/\\]|$)/.test(src));
// issue-resolve is a maintainer workflow, not a format reference a host's Claude Code needs
copy('.claude/skills', '.claude/skills', (src) => !/[/\\]issue-resolve([/\\]|$)/.test(src));
copy('scripts/dash-query.mjs', 'scripts/dash-query.mjs');

writeFileSync(
  join(out, 'tingly-design.json'),
  JSON.stringify({ name: 'tingly-design', version: pkg.version, protocol, entry: 'server.mjs', node: pkg.engines?.node ?? '>=20.11' }, null, 2) + '\n',
);
// The folder is the npm package and the GitHub release asset as it stands (see .design/release.md).
// type: module so `node server.mjs` reads it as an ES module whatever folder it lands in.
writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: '@tingly-dev/tingly-design',
      version: pkg.version,
      description: pkg.description,
      license: pkg.license,
      type: 'module',
      bin: { 'tingly-design': 'cli.mjs' },
      engines: pkg.engines,
      repository: pkg.repository,
      homepage: pkg.homepage,
      bugs: pkg.bugs,
      keywords: pkg.keywords,
    },
    null,
    2,
  ) + '\n',
);
for (const f of ['LICENSE', 'NOTICE']) if (existsSync(join(root, f))) copy(f, f);
writeFileSync(
  join(out, 'README.md'),
  `# Tingly Design ${pkg.version}\n\n` +
    `Canvases, slides, design systems, dashboards, docs and motion pieces as plain files, with an editor.\n\n` +
    `\`\`\`\nnpx tingly-design            # open the editor\nnpx tingly-design --help     # new, list, check, export …\n\`\`\`\n\n` +
    `The command is described in [the command line guide](${pkg.homepage}/blob/main/docs/en/cli.md). ` +
    `A host such as Tingly Box runs \`node server.mjs\`; launch variables, the ready line and the host messages are in [Embedding](${pkg.homepage}/blob/main/docs/en/embedding.md).\n`,
);
writeFileSync(join(out, 'THIRD_PARTY_LICENSES.txt'), thirdPartyNotices());

/** The license text of every production dependency, since server.mjs, editor/ and sandbox/ bundle their code in. */
function thirdPartyNotices() {
  const byLicense = JSON.parse(execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }));
  const deps = Object.values(byLicense).flat().sort((a, b) => a.name.localeCompare(b.name));
  const parts = deps.map((d) => {
    const dir = d.paths[0];
    const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'license', 'license.md', 'LICENSE-MIT'].find((f) => existsSync(join(dir, f)));
    const text = file ? readFileSync(join(dir, file), 'utf8').trim() : `License: ${d.license}`;
    return `${d.name} ${d.versions.join(', ')} (${d.license})\n\n${text}`;
  });
  return `Tingly Design bundles code from the packages below.\n\n${parts.join('\n\n' + '-'.repeat(72) + '\n\n')}\n`;
}

console.log(`bundled tingly-design ${pkg.version} (protocol ${protocol}) into ${out}`);
