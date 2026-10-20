import type en from '../en/cli';
import type { Locale } from '../../types';

export default {
  help: `Tingly Design {{version}}：画布、幻灯片、设计系统、看板、文档和动效，都是普通文件。

用法：tingly-design [命令] [选项]

  （不带命令）                     打开编辑器的启动页
  open [项目]                      在编辑器里打开一个项目
  serve                            只运行服务（给宿主或常驻服务用）
  new <类型> <名字或文件夹>        新建项目：canvas、slides、design-system、dashboard、doc、motion
  new -i                           依次询问类型、标题、文件夹和尺寸（在终端里单打 new 也一样）
  list [项目]                      列出项目，或一个项目里的内容（画板、幻灯片、场景、标签页、数据集）
  check [项目]                     一个项目的问题，或这台机器能做什么
  export <项目> --as <格式>        导出，和"导出"菜单一样：任何项目都可导出 zip（整个项目）；
                                   claude-design：原版 Claude 类型的文件（画布、幻灯片、设计系统、看板）；
                                   画布 png；幻灯片 pdf、png、html、notes；文档 pdf、html、md、png；
                                   设计系统和看板 png；动效 mp4、gif、png（封面）、html（播放器）
  import <文件.zip或文件夹>        从 export --as zip 导出的 .zip（或压缩的项目文件夹）、Claude Design 包（.zip，或
                                   Claude Code 存下来的文件夹）、Claude Docs 导出的 .md 导入项目
  prompt <项目> <请求>             把请求交给 Claude Code，和请求栏一样：它改文件，打开着的编辑器
                                   实时显示；最后列出改了什么
                                   （--fast：由快速 AI 在 Chrome 里改一个画板、幻灯片或场景）
  history <项目>                   改动记录：谁改了哪个文件，最新的在最后
  image <项目> <描述>              用 AI 设置里的图片地址生成一张图，存进项目的 uploads/
                                   （--edit uploads/<文件>：改这张图，而不是新做一张）
  skills [add [文件夹]]            agent 改项目前要读的格式说明；
                                   add 把它们复制到文件夹的 .claude/skills/ 里（默认：当前文件夹）
  mcp                              以 stdio 上的 MCP 服务提供这些命令，给 agent 启动用
                                   （正在运行的编辑器也在 <地址>/mcp 提供）

项目可以是启动页里的名字，也可以是它所在文件夹的路径。编辑器已经在这个项目文件夹上打开时，
open 和 new 交给它来做：不会再起一个服务，启动页上马上能看到。
除了 zip 和动效，导出由编辑器在 Chrome 里画：用已经打开的编辑器，或者为这次导出起一个、导完就停。

选项：
  --projects <文件夹>   项目文件夹（默认：{{projects}}）
  --json                输出数据，给脚本或 agent 用
  --port <端口>         serve、open：端口（0 表示自动挑一个空闲端口）
  --host <地址>         serve、open：监听的地址（默认 127.0.0.1）
  --title <文字>        new：启动页上显示的标题
  -i, --interactive     new：没给出的都问一遍，建好后问要不要打开
  --global              new：名字不建在当前目录，建在项目目录里
  --size <宽>x<高>      new canvas 或 motion：第一个画板或画幅的尺寸；canvas 也可以写新建对话框里的
                        尺寸名（wechat、tall、story、og、a4、wide、mpu……）
  --look <名字>         new design-system：从一个风格开始（nord、swiss-grid、dracula……），而不是空白
  --format <a,b>        export：要渲染的动效画幅（默认：全部）
  --board、--slide、--tab、--view <名字>   export：只导出一个画板（文件名或标题）、一页幻灯片（编号或第几页）、
                        一个标签页（编号或标题）或设计系统的一个视图，而不是全部
  --scale 2             导出画布：PNG @2x；动效：每帧按 2 倍画再缩回（文字更清晰）
  --snapshots           check：另外把每个画板、幻灯片、标签页、视图或封面画一遍，报告画不出来的，
                        图留在 renders/check/（或 --out）里可以看
  --out <文件夹>        export：输出位置（默认：项目的 renders/；zip 放在当前文件夹）
  --files-only          export --as zip：不带改动记录和装进来的设计系统
  --speed、--fps、--quality low|medium|high、--width、--height   export：视频设置；image：--size 1536x1024、--quality
  --edit <uploads/文件> image：改项目里的这张图，而不是新做一张
  --dir <文件夹>        image：存进 uploads/（默认），或设计系统的 assets/<组>
  --since <编号或时间>  history：某条记录（编号见 --json）、某个时间或多久以前（30m、2h、1d）之后的改动
  --limit <n>           history：最近 n 条（默认 20，带 --since 时全部）
  --file <文件>         prompt：请求针对的画板、幻灯片、标签页或场景
  --fast                prompt：用快速 AI 而不是 Claude Code（画布、幻灯片、动效）
  --continue <会话>     prompt：接着之前某次 prompt 输出的某个会话说
  --new                 prompt：开一段新对话（默认接着这个项目上一次的对话）
  --force               skills add：和这个版本不一样的副本也替换掉
  -v, --version         版本号
  -h, --help            本帮助`,
  unknownCommand: '没有 {{name}} 这个命令。运行 tingly-design --help 查看全部命令。',
  needProject: '请指定项目：tingly-design {{command}} <项目>',
  needKind: '请指定类型：canvas、slides、design-system、dashboard、doc 或 motion',
  badKind: '{{kind}} 不是项目类型。类型有：canvas、slides、design-system、dashboard、doc、motion',
  badPage: '{{page}} 不是这种类型的参考页。参考页有：{{pages}}',
  badLook: '--look {{look}} 不是已有的风格：{{looks}}。',
  lookOnlyDs: '--look 只用于设计系统。',
  badBoardSize: '--size {{size}} 既不是宽x高（如 1080x1440），也不是已命名的尺寸：{{sizes}}。',
  needName: '请给项目起名或指定文件夹：tingly-design new {{kind}} <名字或文件夹>',
  globalPath: '--global 把项目放在项目目录里，所以只收名字，不收路径：{{target}}',
  nameTaken: '已经有叫 {{name}} 的项目了。换个名字，或者给一个路径。',
  noProjectAt: '{{path}} 里没有项目',
  created: '已新建{{kind}} {{name}}，位置：{{path}}',
  listEmpty: '{{dir}} 里还没有项目。用 tingly-design new <类型> <名字> 新建一个。',
  badArgs: '{{message}}。运行 tingly-design --help 查看选项。',
  seconds: '{{n}} 秒',
  attached: '在已经运行的编辑器（进程 {{pid}}）里打开 {{url}}。',
  badSince: '--since {{since}} 不是记录编号、时间，也不是多久以前（30m、2h、1d）。',
  noEntry: '{{name}} 的改动记录里没有 {{id}}（只保留最近 500 条）。',
  needImagePrompt: '请描述这张图：tingly-design image {{project}} "<描述>"',
  imageMade: '已生成 {{path}}（{{file}}），用 {{model}}，{{seconds}} 秒。',
  historyEmpty: '{{name}} 还没有改动记录。',
  historyNone: '从那以后 {{name}} 没有改动。',
  historyMore: '更早的 {{count}} 条没有列出（用 --limit，或 --json 看全部）。',
  words: '{{n}} 字',
  needTerminal: '交互式创建需要在终端里运行。请直接给出类型和名字：tingly-design new <类型> <名字或文件夹>',
  cancelled: '已取消，没有创建任何东西。',
  createdNext: '用这个命令打开：tingly-design open {{name}}',
  wizard: {
    kind: '要做什么？',
    group: '尺寸分类',
    size: '尺寸',
    format: '尺寸',
    title: '标题',
    name: '文件夹名，或放到别处的路径',
    custom: '宽 x 高',
    default: '（默认）',
    choose: '输入编号或名字{{default}}：',
    openNow: '现在就在编辑器里打开？',
    complaint: {
      empty: '请给它一个标题。',
      badName: '文件夹名只能用字母、数字、- 和 _，并以字母或数字开头。',
      taken: '{{where}}/{{name}} 已经存在。',
      badSize: '宽和高都要在 1 到 7680 像素之间，例如 1080x1440。',
      badChoice: '不在可选项里。',
    },
  },
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
    snapshot: '画不出来：{{message}}',
    pageError: '编辑器显示它时出错：{{message}}',
    notLoaded: '要用的东西没加载出来：{{message}}',
    seek: '{{total}} 帧里有 {{count}} 帧再次显示时画面不同（差得最多的在 {{at}} 毫秒）：某个场景读了时钟、随机绘制或自己在动，导出的视频会和预览对不上',
  },
  player: { play: '播放', time: '时间', format: '尺寸', speed: '速度' },
  layoutRules: {
    clipped: '文字被框裁掉了：“{{text}}”',
    outside: '文字超出了边缘：“{{text}}”',
    contrast: '文字和背景对比度太低（{{ratio}}:1），不易看清：“{{text}}”',
    contrastMany: '有 {{count}} 处文字和背景对比度太低（最低 {{ratio}}:1，“{{text}}”）',
    blank: '什么也没画出来',
    gap: '从 {{at}} 像素起有一段 {{size}} 像素高（占 {{percent}}%）的空白；把画板改矮，或把内容铺开',
    boxOutside: '有个盒子越过边缘被裁掉了：“{{text}}”',
    boxOverflow: '有个盒子比装它的行或网格还宽，把旁边的挤开了：“{{text}}”',
    squeezed: '文字被挤进只有几个字宽的一列（断成 {{lines}} 行）：“{{text}}”',
  },
  canvasRules: {
    'order-unknown': 'order 里的 {{file}} 不是画板',
    'order-missing': 'order 漏了 {{file}}',
    'order-duplicate': 'order 里 {{file}} 出现了两次',
    'no-x-dc': '第 {{line}} 行：文件里没有 x-dc 块',
    'no-support-script': '第 {{line}} 行：缺少 support.js 的 script 行',
    'root-missing': '第 {{line}} 行：x-dc 里没有根元素',
    'root-size-missing': '第 {{line}} 行：根元素的 style 里要写固定的宽和高',
    'root-size': '第 {{line}} 行：根元素是 {{width}}×{{height}}，canvas.json 里是 {{boardWidth}}×{{boardHeight}}',
    'preview-size': '第 {{line}} 行：$preview 写的是 {{previewWidth}}×{{previewHeight}}，根元素是 {{width}}×{{height}}；别处嵌入这块画板时尺寸会不对',
    'whole-svg': '第 {{line}} 行：整块画板是一个 svg，画布会把它当成一个整体；请用盒子加小的 svg 箭头',
    'unquoted-attr': '第 {{line}} 行：<{{tag}}> 的 {{attr}} 值没有加引号',
    'unclosed-tag': '第 {{line}} 行：<{{tag}}> 没有闭合',
    'stray-close': '第 {{line}} 行：</{{tag}}> 没有对应的开始标签',
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
    running: '编辑器正在 {{url}} 运行（进程 {{pid}}）；open 和 new 会交给它。',
    notRunning: '这个项目文件夹上没有运行中的编辑器；open 会启动一个。',
  },
  exportAs: '{{kind}}不能导出 --as {{as}}，请用 {{formats}}。',
  needAs: '请说明导出什么：tingly-design export {{project}} --as <格式>（任何项目都可以用 zip；各类型的格式见 tingly-design --help）',
  opening: '正在 Chrome 里打开编辑器…',
  noChrome: '这种导出由编辑器在 Chrome 或 Edge 里画，这台机器上两个都没有。请安装一个，或设置 DC_CHROME。',
  noEditorBuild: '这种导出由编辑器的页面来画，这里还没有构建。请运行 pnpm build，或者打开编辑器（pnpm dev）后再导出。',
  noEditorPage: '编辑器没能在 Chrome 里打开（{{detail}}）。',
  noPick: '这个项目里没有 {{what}}',
  notOffered: '这里的"导出"菜单没有 {{item}}',
  nothingSaved: '什么都没有保存',
  exportFailed: '{{what}}：{{error}}',
  snapshotsWrote_one: '{{count}} 张图，在 {{dir}}',
  snapshotsWrote_other: '{{count}} 张图，在 {{dir}}',
  needPrompt: '请说要做什么：tingly-design prompt {{project}} "<请求>"',
  noFast: '{{kind}}没有快速 AI。去掉 --fast，把请求交给 Claude Code。',
  noFile: '这个项目里没有 {{file}}。',
  needFile: '请用 --file 指定画板、幻灯片或场景（没有可以默认的）。',
  promptHandedOver: '快速 AI 把这件事交给了 Claude Code。',
  promptStopped: '已停止。',
  promptChanged_one: '改动记录里多了 {{count}} 条：',
  promptChanged_other: '改动记录里多了 {{count}} 条：',
  promptNoChanges: '没有改动文件。',
  promptContinue: '{{project}} 的下一条 prompt 会接着这段对话（会话 {{session}}）；加 --new 从头开始。',
  notListed: '{{path}} 不在这个编辑器的启动页里。先在启动页用"打开文件夹"打开它，或者用命令行导出。',
  skillsUsage: '用 tingly-design skills 列出它们，或用 tingly-design skills add [文件夹] 复制到一个文件夹里。',
  skill: {
    added: '已添加 {{file}}',
    updated: '已更新 {{file}}',
    same: '已是最新：{{file}}',
    kept: '保留了 {{file}}，它和这个版本的不一样',
  },
  skillsKept: '加上 --force 替换不一样的副本。',
  needZip: '请给出要导入的 .zip：tingly-design import <文件.zip或文件夹>',
  noClaudeDesign: '{{kind}}没有 Claude Design 格式。文档请用 --as md；动效在原版里没有对应类型。',
  importedClaudeDesign: '已导入 {{name}}（来自 Claude Design 的{{kind}}），位于 {{path}}',
  noFileAt: '{{path}} 没有这个文件',
  imported: '已导入 {{name}}，位于 {{path}}',
  importedSystems: '同时导入了设计系统 {{systems}}。',
  noFormat: '这个动效没有 {{format}} 画幅。画幅有：{{formats}}',
  rendering: '正在渲染 {{format}}（{{done}}/{{total}} 帧）',
  wrote: '已写入 {{file}}',
  serving: 'Tingly Design {{version}} 运行在 {{url}}（项目：{{dir}}）。按 Ctrl+C 停止。',
  portBusy: '端口 {{port}} 已被占用，改用 {{free}}。',
} satisfies Locale<typeof en>;
