// The summary of a set of runs, as Markdown for people and JSON for comparing later.

const num = (v, d = 0) => (v === null || v === undefined ? '–' : Number(v).toFixed(d));
const k = (v) => (v === null || v === undefined ? '–' : `${(v / 1000).toFixed(1)}K`);

export function summarize(runs, meta) {
  const lines = [];
  lines.push(`# Agent evaluation ${meta.id}`, '');
  lines.push(`Command line: \`${meta.cli}\` · model: ${meta.model ?? 'default'} · runs per route: ${meta.runs}`, '');
  lines.push('| task | route | result | tool calls | check | look | pictures seen | turns | cost | time | tokens (in / out) | route kept | warnings | judge |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of runs) {
    const m = r.metrics;
    lines.push(
      `| ${r.task} | ${r.route} #${r.n} | ${r.score.pass ? 'pass' : 'FAIL'} | ${m.toolCalls} | ${m.checkRounds} | ${m.lookRounds} | ${m.picturesViewed} | ${m.turns} | ${m.costUsd === null ? '–' : '$' + num(m.costUsd, 2)} | ${r.seconds}s | ${k(m.inputTokens + m.cacheReadTokens)} / ${k(m.outputTokens)} | ${r.purity} | ${r.score.warnings.length} | ${r.judge?.score ?? '–'} |`,
    );
  }
  lines.push('');
  for (const r of runs) {
    lines.push(`## ${r.task} · ${r.route} #${r.n}`, '');
    for (const c of r.score.checks) lines.push(`- ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    if (r.score.warnings.length) lines.push(`- warnings: ${r.score.warnings.map((w) => `${w.code}${w.rule ? `/${w.rule}` : ''} (${w.file})`).join(', ')}`);
    if (r.judge) lines.push(`- judge: ${r.judge.score ?? 'no score'} — ${r.judge.notes}`);
    if (r.purity !== 'pure') lines.push(`- left its route (${r.purity}): ${r.route === 'mcp' ? r.metrics.cliCommands.slice(0, 3).join(' | ') : 'it called the MCP server'}`);
    if (r.exit !== 0) lines.push(`- the agent exited with ${r.exit}: ${r.stderr.trim().split('\n').slice(-2).join(' ')}`);
    lines.push(`- tools used: ${Object.entries(r.metrics.byTool).map(([n, c]) => `${n.replace(/^mcp__tingly-design__/, 'mcp:')}×${c}`).join(', ')}`);
    if (r.score.final) lines.push(`- final picture: ${r.score.final}`);
    lines.push(`- transcript: ${r.transcript}`, '', `> ${r.metrics.result.trim().slice(0, 400).replace(/\n+/g, ' ')}`, '');
  }
  return lines.join('\n');
}

export function toJson(runs, meta) {
  return {
    ...meta,
    runs: runs.map((r) => ({ task: r.task, route: r.route, n: r.n, pass: r.score.pass, checks: r.score.checks, warnings: r.score.warnings, judge: r.judge ?? null, seconds: r.seconds, purity: r.purity, metrics: { ...r.metrics, result: undefined } })),
  };
}
