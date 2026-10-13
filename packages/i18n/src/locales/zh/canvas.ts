import type en from '../en/canvas';
import type { Locale } from '../../types';

export default {
  surface: {
    label: '画布',
  },
  text: {
    placeholder: '文字',
  },
  board: {
    nameLabel: '画板名称',
    stripHint: '{{title}}（{{file}}）— 拖动移动，双击改名',
    fastAiEditing: '快速 AI 正在改',
    claudeEditing: 'Claude Code 正在改',
    error: '出错',
    fullscreen: '全屏打开',
    fullscreenLabel: '全屏打开 {{title}}',
  },
  export: {
    title: '导出',
    boardLabel: '导出 {{title}}',
    source: '源文件 (.dc.html)',
    timeout: '导出超时',
    failed: '导出失败',
  },
  note: {
    titleLabel: '标题',
    contentLabel: '便签内容',
  },
  menu: {
    cut: '剪切',
    paste: '粘贴',
    duplicate: '创建副本',
    toLast: '移到最后',
    toFirst: '移到最前',
    group: '编组',
    ungroup: '取消编组',
    flipH: '水平翻转',
    flipV: '垂直翻转',
    wrapFlex: '包进 flex 容器',
    wrapGrid: '包进 grid 容器',
    deleteBoard: '删除画板',
  },
  format: {
    label: '便签格式',
    size: '字号',
    sizes: {
      s: '小',
      m: '中',
      l: '大',
      xl: '特大',
      xxl: '巨大',
    },
    bold: '粗体',
    italic: '斜体',
    list: '列表',
    textColor: '文字颜色',
    textColorLabel: '文字颜色 {{color}}',
    fill: '底色',
    fillLabel: '底色 {{color}}',
  },
  focus: {
    label: '全屏：{{title}}',
    prev: '上一个画板',
    next: '下一个画板',
    exit: '退出全屏',
  },
  journal: {
    title: '改动记录',
    commit: '提交到 git',
    commitPrompt: '提交说明',
    empty: '每次改动都会记在这里：谁改的（手改、快速 AI、Claude Code、外部编辑）、改了哪个画板、改了什么。',
  },
} satisfies Locale<typeof en>;
