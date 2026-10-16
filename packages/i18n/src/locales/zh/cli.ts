import type en from '../en/cli';
import type { Locale } from '../../types';

export default {
  help: `Tingly Design {{version}}：画布、幻灯片、设计系统、看板、文档和动效，都是普通文件。

用法：tingly-design [命令] [选项]

  （不带命令）                     打开编辑器的启动页
  open [项目]                      在编辑器里打开一个项目
  serve                            只运行服务（给宿主或常驻服务用）
  new <类型> <名字或文件夹>        新建项目：canvas、slides、design-system、dashboard、doc、motion
  list [项目]                      列出项目，或一个项目里的内容（画板、幻灯片、场景、标签页、数据集）
  check [项目]                     一个项目的问题，或这台机器能做什么
  export <项目> --as <格式>        导出：动效可导出 mp4、gif 或 png（封面）

项目可以是启动页里的名字，也可以是它所在文件夹的路径。

选项：
  --projects <文件夹>   项目文件夹（默认：{{projects}}）
  --json                输出数据，给脚本或 agent 用
  --port <端口>         serve、open：端口（0 表示自动挑一个空闲端口）
  --host <地址>         serve、open：监听的地址（默认 127.0.0.1）
  --title <文字>        new：启动页上显示的标题
  --size <宽>x<高>      new canvas 或 motion：第一个画板或画幅的尺寸
  --format <a,b>        export：要渲染的动效画幅（默认：全部）
  --out <文件夹>        export：输出位置（默认：项目的 renders/）
  --speed、--fps、--quality low|medium|high、--width、--height   export：视频设置
  -v, --version         版本号
  -h, --help            本帮助`,
  unknownCommand: '没有 {{name}} 这个命令。运行 tingly-design --help 查看全部命令。',
  needProject: '请指定项目：tingly-design {{command}} <项目>',
  needKind: '请指定类型：canvas、slides、design-system、dashboard、doc 或 motion',
  badKind: '{{kind}} 不是项目类型。类型有：canvas、slides、design-system、dashboard、doc、motion',
  needName: '请给项目起名或指定文件夹：tingly-design new {{kind}} <名字或文件夹>',
  noProjectAt: '{{path}} 里没有项目',
  created: '已新建{{kind}} {{name}}，位置：{{path}}',
  listEmpty: '{{dir}} 里还没有项目。用 tingly-design new <类型> <名字> 新建一个。',
  badArgs: '{{message}}。运行 tingly-design --help 查看选项。',
  seconds: '{{n}} 秒',
  words: '{{n}} 字',
  kind: {
    design: '画布',
    slides: '幻灯片',
    'design-system': '设计系统',
    dashboard: '看板',
    docs: '文档',
    motion: '动效',
  },
  problems: {
    badIndex: '{{file}} 不是可读的 JSON',
    missingFile: '列出了 {{ref}}，但这个文件不存在',
    unlisted: '没有列在 {{ref}} 里，编辑器不会显示它',
    badCover: '封面场景 {{ref}} 不存在',
    badFile: '{{message}}',
    issue: '{{message}}',
    badDataset: '{{message}}',
    badTokens: '{{message}}',
  },
  noProblems: '{{name}} 没有问题。',
  problemCount_one: '{{count}} 个问题',
  problemCount_other: '{{count}} 个问题',
  machine: {
    title: '这台机器上的 Tingly Design {{version}}',
    projects: '项目文件夹：{{dir}}',
    chrome: 'Chrome 或 Edge：{{path}}',
    noChrome: '没有 Chrome 或 Edge：请安装一个，或设置 DC_CHROME。导出图片、PDF 和视频都需要它。',
    ffmpeg: 'ffmpeg：已找到',
    noFfmpeg: '没有 ffmpeg：请安装，或设置 DC_FFMPEG。导出视频需要它。',
    claude: 'Claude Code（claude）：已找到',
    noClaude: 'PATH 里没有 Claude Code（claude）：交给 Claude Code 需要它。',
    fast: '快速 AI：{{model}}',
    noFast: '快速 AI：还没有设置模型连接。打开编辑器的 AI 设置，或设置 ANTHROPIC_API_KEY。',
  },
  exportKind: '命令行还不能导出{{kind}}，请先在编辑器里用"导出"。动效可以导出 mp4、gif 或 png。',
  exportAs: '动效不能导出 --as {{as}}，请用 mp4、gif 或 png。',
  needAs: '请说明导出什么：tingly-design export {{project}} --as mp4|gif|png',
  noFormat: '这个动效没有 {{format}} 画幅。画幅有：{{formats}}',
  rendering: '正在渲染 {{format}}（{{done}}/{{total}} 帧）',
  wrote: '已写入 {{file}}',
  serving: 'Tingly Design {{version}} 运行在 {{url}}（项目：{{dir}}）。按 Ctrl+C 停止。',
  portBusy: '端口 {{port}} 已被占用，改用 {{free}}。',
} satisfies Locale<typeof en>;
