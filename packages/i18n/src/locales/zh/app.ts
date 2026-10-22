import type en from '../en/app';
import type { Locale } from '../../types';

export default {
  actor: {
    human: '手改',
    jquery: 'jQuery',
    'fast-edit': '快速 AI',
    claude: 'Claude',
    external: '外部',
    undo: '撤销',
  },
  open: {
    failed: '这个项目打不开：{{error}}',
    home: '全部项目',
  },
  delegate: {
    done: 'Claude Code 完成：{{text}}',
    failed: 'Claude Code 没能完成：{{text}}',
  },
  journal: {
    undoClaude: '撤销 Claude Code 的改动',
    jqStatements_other: '{{count}} 条 jQuery 语句',
    statements_other: '{{count}} 条语句',
  },
  save: {
    editFailed: '{{file}}：{{error}}',
    failed: '保存 {{file}} 失败：{{error}}',
    keptChanging: '{{file}} 一直在被其他人修改，这次编辑没有保存。',
    deleteConflict: '{{file}} 刚被别人改过，没有删除。',
  },
  clipboard: {
    empty: '剪贴板是空的。',
    selectFirst: '先选中一个元素或画板，再粘贴。',
  },
  scene: {
    notInEditor: '场景的新建、复制和删除还没有放进编辑器，可以交给 Claude Code。',
  },
  board: {
    rootDelete: '这是画板的根元素；要删除整个画板，请选中画板再删除。',
    rootWrap: '画板的根元素不能再包一层。',
    rootUnwrap: '画板的根元素不能拆开。',
    noChildren: '这个元素里面没有可以拆出来的子元素。',
    newTitle: '新画板',
    copyTitle: '{{title}} 副本',
  },
  confirm: {
    deleteSlide: '删除这一页（{{slide}}）？文件也会被删除（可以用 git 找回）。',
    deleteBoard: '删除画板 {{file}}？文件也会被删除（可以用 git 找回）。',
  },
  page: {
    name: '第 {{n}} 页',
  },
  executor: {
    noResponse: '执行器没有响应',
    replayFailed: '改动无法在新版本上重放：{{error}}',
  },
  fast: {
    delegateFailed: '没能交给 Claude Code：{{error}}',
    handOffFailed: '快速 AI 想交给 Claude Code，但没能交出去。',
    threeFailures: '三次都没能执行成功：{{error}}',
    retry: '改动已撤销，第 {{n}} 次重试',
    retrySlide: '超出了幻灯片格式，改动已撤销，第 {{n}} 次重试',
    noChange: '没有产生改动。',
    stopped: '已停止，没有保存任何改动。',
  },
  attach: {
    convertFailed: '图片转换失败',
    pastedImage: '粘贴的图片',
    unsupported: '不支持这种文件：{{name}}（可以附图片、PDF 和文本文件）',
    tooLarge: '{{name}} 超过 {{size}}',
    tooLong: '{{name}} 太长（超过 {{k}}k 字符）',
    tooMany_other: '一次最多附 {{count}} 个文件',
  },
  tool: {
    withKeys: '{{label}}（{{keys}}）',
    bar: '工具',
    select: '选择',
    hand: '抓手',
    text: '文字',
    frame: '画板',
    note: '便签',
    draw: '画笔',
    shapes: '形状和线条',
  },
  shape: {
    rect: '矩形',
    oval: '椭圆',
    arrow: '箭头',
    line: '直线',
  },
  pages: {
    label: '页面',
    nameLabel: '页面名称',
    add: '新建页面',
    button: '{{name}}，页面',
  },
  importTarget: '画布',
  view: {
    bar: '视图',
    exitPlay: '退出播放',
    play: '播放',
    playHint: '播放：按钮和链接可以点（Esc 退出）',
    panel: '属性面板',
    panelHint: '属性面板（⌘\\）',
    zoomButton: '{{zoom}}%，缩放',
    zoom: '缩放',
    zoomIn: '放大',
    zoomOut: '缩小',
    fitAll: '适应全部',
    zoomToSelection: '缩放到选中',
  },
} satisfies Locale<typeof en>;
