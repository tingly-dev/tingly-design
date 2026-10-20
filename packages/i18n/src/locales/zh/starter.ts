import type en from '../en/starter';
import type { Locale } from '../../types';

export default {
  canvasHint: '双击改字，或在下方让 AI 修改。',
  slideTitle: '标题',
  slideHint: '双击改字，或在下方让 AI 修改这一页。',
  dashEmpty: '还没有数据。把 CSV / JSON 放进 data/，或者让 Claude Code 连上数据、写这个看板。',
  docTab: '正文',
  dsReadme: '# {{title}}\n\n{{title}} 的设计系统。从品牌的真实来源（代码库、设计稿、品牌手册）补全它，或者让 Claude Code 来做。\n\n## 使用\n\n颜色是语义 token（`surface`、`ink`、`accent`），每个 token 的说明写明它用在什么底色上。\n',
  dsLookReadme: '# {{title}}\n\n{{title}} 的设计系统，从「{{look}}」风格开始：它的颜色、字体族、圆角和阴影。文字样式和间距是通用的起点；都可以改，也可以让 Claude Code 来改。\n\n## 使用\n\n颜色是语义 token（`surface`、`ink`、`accent`），每个 token 的说明写明它用在什么底色上。\n\n## 来源\n\n这个风格来自 html-ppt 模板的 `{{id}}` 主题，MIT 许可，Copyright (c) 2026 lewis <sudolewis@gmail.com>，取自 OpenDesign 的设计模板（https://github.com/nexu-io/open-design）。\n',
} satisfies Locale<typeof en>;
