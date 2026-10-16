/** The `tingly-design` command's own words: help, what each command prints, and why it stopped. */
export default {
  help: `Tingly Design {{version}}: canvases, slides, design systems, dashboards, docs and motion pieces as plain files.

Usage: tingly-design [command] [options]

  (no command)                     open the editor at the launcher
  open [project]                   open a project in the editor
  serve                            run the server only (for a host or a service)
  new <kind> <name or folder>      create a project: canvas, slides, design-system, dashboard, doc, motion
  list [project]                   the projects, or what is in one (boards, slides, scenes, tabs, datasets)
  check [project]                  a project's problems, or what this machine can do
  export <project> --as <format>   export: any project as zip (the whole project); a motion piece also as mp4, gif or png (its cover)
  import <file.zip>                a project from a .zip made by export --as zip (or a zipped project folder)

A project is a name from the launcher or a path to its folder.

Options:
  --projects <folder>   the projects folder (default: {{projects}})
  --json                print data for a script or an agent
  --port <n>            serve, open: the port (0 picks a free one)
  --host <address>      serve, open: the address to listen on (default 127.0.0.1)
  --title <text>        new: the title shown in the launcher
  --size <W>x<H>        new canvas or motion: the first artboard's or format's size
  --format <a,b>        export: the motion formats to render (default: all)
  --out <folder>        export: where files go (default: the project's renders/; a zip goes to the current folder)
  --files-only          export --as zip: leave out the change log and the design systems it installed
  --speed, --fps, --quality low|medium|high, --width, --height   export: video settings
  -v, --version         the version
  -h, --help            this help`,
  unknownCommand: 'Unknown command {{name}}. Run tingly-design --help for the list.',
  needProject: 'Name a project: tingly-design {{command}} <project>',
  needKind: 'Name a kind: canvas, slides, design-system, dashboard, doc or motion',
  badKind: '{{kind}} is not a kind. Kinds: canvas, slides, design-system, dashboard, doc, motion',
  needName: 'Name the project or give a folder: tingly-design new {{kind}} <name or folder>',
  noProjectAt: 'There is no project at {{path}}',
  created: 'Created {{kind}} {{name}} in {{path}}',
  listEmpty: 'No projects yet in {{dir}}. Create one with tingly-design new <kind> <name>.',
  badArgs: '{{message}}. Run tingly-design --help for the options.',
  seconds: '{{n}}s',
  words: '{{n}} words',
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
  },
  exportKind: 'From the command line a {{kind}} exports as zip (the whole project); its other formats are in Export in the editor. A motion piece also exports as mp4, gif or png.',
  exportAs: '--as {{as}} is not something a motion piece exports. Use zip, mp4, gif or png.',
  needAs: 'Say what to export: tingly-design export {{project}} --as zip|mp4|gif|png',
  needZip: 'Name the .zip to import: tingly-design import <file.zip>',
  noFileAt: 'There is no file at {{path}}',
  imported: 'Imported {{name}} into {{path}}',
  importedSystems: 'With the design system {{systems}}.',
  noFormat: '{{format}} is not a format of this piece. Formats: {{formats}}',
  rendering: 'Rendering {{format}} ({{done}}/{{total}} frames)',
  wrote: 'Wrote {{file}}',
  serving: 'Tingly Design {{version}} on {{url}} (projects: {{dir}}). Press Ctrl+C to stop.',
  portBusy: 'Port {{port}} is in use; using {{free}} instead.',
};
