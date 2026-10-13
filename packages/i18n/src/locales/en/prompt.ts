export default {
  /** one Claude Code step in the run feed (core's AgentStep.op) */
  step: {
    readSkill: 'Read the format reference',
    read: 'Read {{target}}',
    glob: 'Find files {{target}}',
    grep: 'Search for “{{target}}”',
    grepIn: 'Search for “{{target}}” in {{within}}',
    write: 'Write {{target}}',
    edit: 'Edit {{target}}',
    query: 'Query the data',
    run: 'Run {{target}}',
    plan: 'List the steps',
    tool: '{{target}}',
  },
  /** how long a run has taken (core's elapsed()) */
  elapsed: {
    seconds: '{{s}}s',
    minutes: '{{m}}m {{ss}}s',
  },
};
