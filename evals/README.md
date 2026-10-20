# evals: can an agent do a design with Tingly Design?

Has headless Claude Code do one design task twice, once by the command line and the skills (`skill`), once by the MCP server (`mcp`), scores what it left behind through Tingly Design's own command line, and prints one comparison. It touches only Tingly Design's public surfaces, so it can evaluate the source, the bundle or the npm package. Design and reasoning: `.design/agent-evals.md`.

```bash
pnpm eval -- --list                         # the tasks
pnpm eval                                   # every task, both routes, once
pnpm eval -- --task steep-pricing --route mcp --runs 3 --judge
pnpm eval -- --cli "node dist/tingly-design/cli.mjs"   # evaluate the bundle (run `pnpm bundle` first)
```

Needs `claude` signed in and Chrome (`DC_CHROME`, and `DC_CHROME_SANDBOX=0` in a container). Each run costs about 20 cents and a minute or two; it is not part of `pnpm test` or CI. Results go to `evals/out/<time>/`: `summary.md` (the table, each run's checks, the final picture), `summary.json`, and per run the transcript and the agent's workspace.

- `tasks/*.json`: the brief, what must exist (`expect`, `mustContain`, `export`) and the rubric for `--judge`. Add a task by adding a file.
- `lib/drivers.mjs`: the only file that knows about `claude`, and the two routes.
- `lib/transcript.mjs`, `lib/score.mjs`: reading a run and scoring it; unit-tested with fixtures by `pnpm test`.
