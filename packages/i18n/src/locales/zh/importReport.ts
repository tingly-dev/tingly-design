import type en from '../en/importReport';
import type { Locale } from '../../types';

export default {
  note: {
    fromSvg: '从 SVG 导入',
    fromHtml: '从 HTML 导入',
    fromSvgFile: '从 SVG 导入：{{file}}',
    fromHtmlFile: '从 HTML 导入：{{file}}',
    allSvg: '图形完整带过来了',
    allHtml: '页面的内容和样式都带过来了',
    nextSvg: '图形保持为 SVG：选中形状可以改颜色、描边和位置，文字（如果还是文字）可以直接改。想把它变成普通的布局元素（flex、可改的文字），选中画板让 AI 重建。',
    nextHtml: '每个元素的样式都写在它自己的 style 里，可以直接选中修改。想要更干净的结构（flex 布局、少一些嵌套），选中画板让 AI 整理。',
  },
  line: {
    artboards_other: '{{count}} 个画板',
    elements_other: '{{count}} 个元素',
    summary: '{{artboards}}，{{elements}}',
    summaryTruncated: '{{artboards}}，{{elements}}（超过上限，后面的内容没有导入）',
    scripts_other: '{{count}} 段脚本没有带过来：导入的是页面渲染后的静态样子，交互需要另外做',
    stateRules_other: '{{count}} 条悬停、聚焦等状态样式没有带过来',
    otherMediaRules_other: '{{count}} 条只在其他屏幕宽度生效的样式没有带过来',
    hidden_other: '{{count}} 个隐藏元素（display:none）没有导入',
    transparent_other: '{{count}} 处内容是透明的（opacity 为 0，多半是滚动时才出现的动画），选中后把不透明度改成 100% 就能看到',
    pseudoElements_other: '{{count}} 个 ::before / ::after 变成了真实的 <span>',
    dropped: '画布放不了的元素已去掉：{{list}}',
    unreadableSheets_other: '{{count}} 个样式表读不到（跨域），对应的样式会缺失',
    missing_other: '{{count}} 个引用的文件不在导入的文件里：{{list}}',
    missingMore_other: '{{count}} 个引用的文件不在导入的文件里：{{list}} 等',
    remoteUrls_other: '{{count}} 个资源仍是外链，没有复制进项目',
    outlinedText: '没有可改的文字：文字在导出时多半被转成了路径。Figma 导出 SVG 时取消勾选 "Outline text"，文字就能保留下来',
    bitmaps_other: '{{count}} 张嵌入的位图（截图、照片）作为图片导入，里面的内容不能编辑',
  },
  listSep: '、',
  error: {
    notSvg: '这不是一个有效的 SVG 文件',
  },
} satisfies Locale<typeof en>;
