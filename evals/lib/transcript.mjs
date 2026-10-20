// Reads a Claude Code `--output-format stream-json` transcript into the numbers an evaluation compares.
// Pure: text in, data out, so it is tested on a fixture (evals/test).

/** One transcript line per event; lines that are not JSON are skipped. */
export function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a torn line
    }
  }
  return out;
}

const PICTURE = /\.(png|jpe?g|webp)$/i;

/**
 * What the agent did. `cli` is the words that name Tingly Design's command line in a shell command (so
 * `--projects x check steep` counts as a check), `server` the MCP server's name.
 */
export function measure(events, { cli = 'tingly-design', server = 'tingly-design' } = {}) {
  const m = {
    turns: 0,
    toolCalls: 0,
    byTool: {},
    checkRounds: 0,
    lookRounds: 0,
    exports: 0,
    picturesViewed: 0,
    skillReads: 0,
    mcpCalls: 0,
    shellCalls: 0,
    cliCommands: [],
    errors: 0,
    costUsd: null,
    durationMs: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    result: '',
    ok: null,
  };
  const prefix = `mcp__${server}__`;
  const pending = new Map();
  for (const e of events) {
    if (e.type === 'assistant') {
      for (const c of e.message?.content ?? []) {
        if (c.type !== 'tool_use') continue;
        m.toolCalls++;
        m.byTool[c.name] = (m.byTool[c.name] ?? 0) + 1;
        const input = c.input ?? {};
        pending.set(c.id, c.name);
        if (c.name.startsWith(prefix)) {
          m.mcpCalls++;
          const tool = c.name.slice(prefix.length);
          if (tool === 'check') m.checkRounds++;
          if (tool === 'look') m.lookRounds++;
          if (tool === 'export') m.exports++;
        } else if (c.name === 'Bash') {
          m.shellCalls++;
          const cmd = String(input.command ?? '');
          if (cmd.includes(cli)) {
            if (/\bcheck\b/.test(cmd)) (/--snapshots/.test(cmd) ? m.lookRounds++ : m.checkRounds++);
            if (/\bexport\b/.test(cmd)) m.exports++;
            m.cliCommands.push(cmd.split('\n')[0].slice(0, 160));
          }
        } else if (c.name === 'Read') {
          const p = String(input.file_path ?? '');
          if (PICTURE.test(p)) m.picturesViewed++;
          if (/[\\/]skills[\\/]/.test(p)) m.skillReads++;
        } else if (c.name === 'Skill') {
          m.skillReads++;
        }
      }
      m.turns++;
    } else if (e.type === 'user') {
      for (const c of e.message?.content ?? []) {
        if (c.type !== 'tool_result') continue;
        if (c.is_error) m.errors++;
        // pictures a tool handed back inside its result
        if (Array.isArray(c.content)) for (const part of c.content) if (part.type === 'image') m.picturesViewed++;
      }
    } else if (e.type === 'result') {
      m.costUsd = e.total_cost_usd ?? null;
      m.durationMs = e.duration_ms ?? null;
      m.ok = e.is_error === false || e.subtype === 'success';
      m.result = String(e.result ?? '');
      const u = e.usage ?? {};
      m.inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      m.cacheReadTokens = u.cache_read_input_tokens ?? 0;
      m.outputTokens = u.output_tokens ?? 0;
      if (typeof e.num_turns === 'number') m.turns = e.num_turns;
    }
  }
  return m;
}

/**
 * Whether a route stayed itself: an MCP run should never reach for the command line, and a command-line
 * run never uses the MCP server. `cliCommands` lists the shell commands that named the command line.
 */
export function purity(m, route) {
  if (route === 'mcp') return m.cliCommands.length === 0 ? 'pure' : 'used-cli';
  return m.mcpCalls === 0 ? 'pure' : 'used-mcp';
}
