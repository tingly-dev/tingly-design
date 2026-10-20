/** The `tingly-design` command's own words: help, what each command prints, and why it stopped. */
export default {
  help: `Tingly Design {{version}}: canvases, slides, design systems, dashboards, docs and motion pieces as plain files.

Usage: tingly-design [command] [options]

  (no command)                     open the editor at the launcher
  open [project]                   open a project in the editor
  serve                            run the server only (for a host or a service)
  new <kind> <name or folder>      create a project: canvas, slides, design-system, dashboard, doc, motion
  new -i                           ask for the kind, title, folder and size (also: new with nothing, in a terminal)
  list [project]                   the projects, or what is in one (boards, slides, scenes, tabs, datasets)
  check [project]                  a project's problems, or what this machine can do
  export <project> --as <format>   export, as the Export menu does: any project as zip (the whole project);
                                   claude-design: the original Claude type's files (canvas, slides, design system, dashboard);
                                   canvas png; slides pdf, png, html, notes; doc pdf, html, md, png;
                                   design system and dashboard png; motion mp4, gif, png (its cover), html (a player)
  import <file.zip or folder>      a project from a .zip made by export --as zip (or a zipped project folder), a Claude
                                   Design package (the .zip, or the folder Claude Code saved) or a Claude Docs .md export
  prompt <project> <request>       hand a request to Claude Code, as the request bar does: it edits the
                                   files, the open editor shows it live; prints what it changed
                                   (--fast: the fast AI edits one board, slide or scene in Chrome)
  history <project>                the change history: who changed which file, newest last
  skills [add [folder]]            the format references an agent reads before editing a project;
                                   add copies them into the folder's .claude/skills/ (default: here)
  mcp                              these commands as an MCP server on stdio, for an agent to start
                                   (the running editor also serves them at <address>/mcp)

A project is a name from the launcher or a path to its folder. With the editor already open on the
projects folder, open and new go through it: no second server, and the launcher shows the change at once.
Exports other than zip and motion are drawn by the editor in Chrome: the one already open, or one
started for the export and stopped after it.

Options:
  --projects <folder>   the projects folder (default: {{projects}})
  --json                print data for a script or an agent
  --port <n>            serve, open: the port (0 picks a free one)
  --host <address>      serve, open: the address to listen on (default 127.0.0.1)
  --title <text>        new: the title shown in the launcher
  -i, --interactive     new: ask for whatever is not given, then offer to open the project
  --global              new: keep a bare name in the projects folder instead of a folder of that name here
  --size <W>x<H>        new canvas or motion: the first artboard's or format's size; a canvas also takes a
                        name from the New dialog's list (wechat, tall, story, og, a4, wide, mpu, …)
  --format <a,b>        export: the motion formats to render (default: all)
  --board, --slide, --tab, --view <name>   export: one board (file or title), slide (id or number),
                        tab (id or title) or design-system view, instead of all of them
  --scale 2             export a canvas: PNG @2x; motion: draw each frame at 2× and scale it down (sharper type)
  --snapshots           check: also draw every board, slide, tab, view or cover, report what fails,
                        and keep the pictures (in renders/check/, or --out) to look at
  --out <folder>        export: where files go (default: the project's renders/; a zip goes to the current folder)
  --files-only          export --as zip: leave out the change log and the design systems it installed
  --speed, --fps, --quality low|medium|high, --width, --height   export: video settings
  --since <id or time>  history: after an entry id (from --json), a time, or how long ago (30m, 2h, 1d)
  --limit <n>           history: the last n entries (default 20, all with --since)
  --file <file>         prompt: the board, slide, tab or scene the request is about
  --fast                prompt: fast AI instead of Claude Code (canvas, slides, motion)
  --continue <session>  prompt: continue a particular conversation an earlier prompt printed
  --new                 prompt: start a new conversation (the project's last one is continued by default)
  --force               skills add: replace a copy that differs from this version's
  -v, --version         the version
  -h, --help            this help`,
  unknownCommand: 'Unknown command {{name}}. Run tingly-design --help for the list.',
  needProject: 'Name a project: tingly-design {{command}} <project>',
  needKind: 'Name a kind: canvas, slides, design-system, dashboard, doc or motion',
  badKind: '{{kind}} is not a kind. Kinds: canvas, slides, design-system, dashboard, doc, motion',
  badPage: '{{page}} is not a reference page of this kind. Pages: {{pages}}',
  badBoardSize: '--size {{size}} is neither a width and height (1080x1440) nor one of the named sizes: {{sizes}}.',
  needName: 'Name the project or give a folder: tingly-design new {{kind}} <name or folder>',
  globalPath: '--global keeps a project in the projects folder, so it takes a name, not a path: {{target}}',
  nameTaken: 'There is already a project called {{name}}. Pick another name, or give a path.',
  noProjectAt: 'There is no project at {{path}}',
  created: 'Created {{kind}} {{name}} in {{path}}',
  listEmpty: 'No projects yet in {{dir}}. Create one with tingly-design new <kind> <name>.',
  badArgs: '{{message}}. Run tingly-design --help for the options.',
  seconds: '{{n}}s',
  attached: 'Opening {{url}} in the editor already running (process {{pid}}).',
  badSince: '--since {{since}} is not an entry id, a time or how long ago (30m, 2h, 1d).',
  noEntry: '{{name}}’s change history has no entry {{id}} (it keeps the last 500).',
  historyEmpty: 'No changes recorded in {{name}} yet.',
  historyNone: 'No changes in {{name}} since then.',
  historyMore: '{{count}} earlier changes not shown (--limit, or --json for all).',
  words: '{{n}} words',
  needTerminal: 'Interactive creation needs a terminal. Give the kind and name instead: tingly-design new <kind> <name or folder>',
  cancelled: 'Cancelled, nothing was created.',
  createdNext: 'Open it with: tingly-design open {{name}}',
  wizard: {
    kind: 'What are you making?',
    group: 'Size category',
    size: 'Size',
    format: 'Size',
    title: 'Title',
    name: 'Folder name, or a path to keep it somewhere else',
    custom: 'Width x height',
    default: '(default)',
    choose: 'Choose a number or a name{{default}}:',
    openNow: 'Open it in the editor now?',
    complaint: {
      empty: 'Give it a title.',
      badName: 'A folder name can only use letters, digits, - and _, and must start with a letter or digit.',
      taken: '{{where}}/{{name}} already exists.',
      badSize: 'Width and height are each from 1 to 7680 px, like 1080x1440.',
      badChoice: 'Not one of the choices.',
    },
  },
  kind: {
    design: 'canvas',
    slides: 'slides',
    'design-system': 'design system',
    dashboard: 'dashboard',
    docs: 'doc',
    motion: 'motion',
  },
  problems: {
    badIndex: '{{file}} is not readable JSON',
    missingFile: 'lists {{ref}}, which is missing',
    unlisted: 'is not listed in {{ref}}, so the editor does not show it',
    badCover: 'the cover scene {{ref}} is missing',
    badFile: '{{message}}',
    issue: '{{message}}',
    badDataset: '{{message}}',
    badTokens: '{{message}}',
    snapshot: 'could not be drawn: {{message}}',
    pageError: 'threw while the editor showed it: {{message}}',
    notLoaded: 'asked for something that did not load: {{message}}',
    seek: '{{count}} of {{total}} frames come out different when shown again (most at {{at}} ms): something in a scene reads the clock, draws at random or animates on its own, so the video will not match the preview',
  },
  player: { play: 'Play', time: 'Time', format: 'Format', speed: 'Speed' },
  layoutRules: {
    clipped: 'text is cut off by its box: “{{text}}”',
    outside: 'text runs past the edge: “{{text}}”',
    contrast: 'text is hard to read on its background (contrast {{ratio}}:1): “{{text}}”',
    contrastMany: '{{count}} texts are hard to read on their background (the faintest at contrast {{ratio}}:1, “{{text}}”)',
    blank: 'nothing is drawn',
    gap: 'a band {{size}} px tall ({{percent}}% of the height) is empty from {{at}} px down; shrink the board or spread the content',
    boxOutside: 'a box runs past the edge and is cut off: “{{text}}”',
    boxOverflow: 'a box is wider than the row or grid that holds it, so it pushes its neighbours aside: “{{text}}”',
    squeezed: 'text is squeezed into a column a few characters wide ({{lines}} lines): “{{text}}”',
  },
  canvasRules: {
    'order-unknown': 'order lists {{file}}, which is not a board',
    'order-missing': 'order leaves out {{file}}',
    'order-duplicate': 'order lists {{file}} twice',
    'no-x-dc': 'line {{line}}: the file has no x-dc block',
    'no-support-script': 'line {{line}}: the support.js script line is missing',
    'root-missing': 'line {{line}}: x-dc holds no root element',
    'root-size-missing': 'line {{line}}: the root element needs a fixed width and height in its style',
    'root-size': 'line {{line}}: the root is {{width}}×{{height}} but canvas.json says {{boardWidth}}×{{boardHeight}}',
    'preview-size': 'line {{line}}: $preview says {{previewWidth}}×{{previewHeight}} but the root is {{width}}×{{height}}; an embed of this board would be drawn at the wrong size',
    'whole-svg': 'line {{line}}: the board is one svg, which the canvas picks as a single block; draw boxes and small svg arrows',
    'unquoted-attr': 'line {{line}}: {{attr}} on <{{tag}}> has no quotes around its value',
    'unclosed-tag': 'line {{line}}: <{{tag}}> is never closed',
    'stray-close': 'line {{line}}: </{{tag}}> closes nothing',
  },
  noProblems: 'No problems in {{name}}.',
  problemCount_one: '{{count}} problem',
  problemCount_other: '{{count}} problems',
  machine: {
    title: 'Tingly Design {{version}} on this machine',
    projects: 'Projects folder: {{dir}}',
    chrome: 'Chrome or Edge: {{path}}',
    noChrome: 'No Chrome or Edge: install one, or set DC_CHROME. Exporting pictures, PDF and video needs it.',
    ffmpeg: 'ffmpeg: found',
    noFfmpeg: 'No ffmpeg: install it, or set DC_FFMPEG. Exporting video needs it.',
    claude: 'Claude Code (claude): found',
    noClaude: 'No Claude Code (claude) on PATH: handing work to Claude Code needs it.',
    fast: 'Fast AI: {{model}}',
    noFast: 'Fast AI: no model connection set. Open the editor’s AI settings, or set ANTHROPIC_API_KEY.',
    running: 'The editor is running at {{url}} (process {{pid}}); open and new go through it.',
    notRunning: 'The editor is not running on this projects folder; open starts it.',
  },
  exportAs: '--as {{as}} is not something a {{kind}} exports. Use {{formats}}.',
  needAs: 'Say what to export: tingly-design export {{project}} --as <format> (zip for any project; tingly-design --help lists each kind’s)',
  opening: 'Opening the editor in Chrome…',
  noChrome: 'This export is drawn by the editor in Chrome or Edge, and there is neither on this machine. Install one, or set DC_CHROME.',
  noEditorBuild: 'This export is drawn by the editor’s page, which is not built here. Run pnpm build, or open the editor (pnpm dev) and export again.',
  noEditorPage: 'The editor did not open in Chrome ({{detail}}).',
  noPick: 'there is nothing called {{what}} in this project',
  notOffered: 'the Export menu has no {{item}} here',
  nothingSaved: 'nothing was saved',
  exportFailed: '{{what}}: {{error}}',
  snapshotsWrote_one: '{{count}} picture in {{dir}}',
  snapshotsWrote_other: '{{count}} pictures in {{dir}}',
  needPrompt: 'Say what to do: tingly-design prompt {{project}} "<request>"',
  noFast: 'Fast AI is not offered for a {{kind}}. Leave out --fast to hand the request to Claude Code.',
  noFile: 'There is no {{file}} in this project.',
  needFile: 'Name the board, slide or scene with --file (there is none to default to).',
  promptHandedOver: 'Fast AI handed this to Claude Code.',
  promptStopped: 'Stopped.',
  promptChanged_one: '{{count}} change in the history:',
  promptChanged_other: '{{count}} changes in the history:',
  promptNoChanges: 'No files changed.',
  promptContinue: 'The next prompt on {{project}} continues this conversation (session {{session}}); add --new to start over.',
  notListed: '{{path}} is not in this editor’s launcher. Open it there first (Open a folder), or export it with the command line.',
  skillsUsage: 'Use tingly-design skills to list them, or tingly-design skills add [folder] to copy them into a folder.',
  skill: {
    added: 'Added {{file}}',
    updated: 'Updated {{file}}',
    same: 'Up to date: {{file}}',
    kept: 'Kept {{file}}, which differs from this version’s',
  },
  skillsKept: 'Add --force to replace the copies that differ.',
  needZip: 'Name the .zip to import: tingly-design import <file.zip or folder>',
  noClaudeDesign: 'A {{kind}} has no Claude Design format. Docs go through Markdown (--as md); motion has no original type.',
  importedClaudeDesign: 'Imported {{name}} ({{kind}} from Claude Design) into {{path}}',
  noFileAt: 'There is no file at {{path}}',
  imported: 'Imported {{name}} into {{path}}',
  importedSystems: 'With the design system {{systems}}.',
  noFormat: '{{format}} is not a format of this piece. Formats: {{formats}}',
  rendering: 'Rendering {{format}} ({{done}}/{{total}} frames)',
  wrote: 'Wrote {{file}}',
  serving: 'Tingly Design {{version}} on {{url}} (projects: {{dir}}). Press Ctrl+C to stop.',
  portBusy: 'Port {{port}} is in use; using {{free}} instead.',
};
