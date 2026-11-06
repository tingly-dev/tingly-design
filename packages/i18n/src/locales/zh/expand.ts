import type en from '../en/expand';
import type { Locale } from '../../types';

export default {
  title: '内容',
  popover: '编辑内容',
  close: '关闭',
  more: '还有 {{count}} 处：选中其中一个，或双击更小的部分，只看它自己的。',
  repeated: '列表的每一行都会画一次：在这里改，每一行都跟着变。',
  role: {
    picture: '图片',
    video: '视频',
    link: '链接',
    input: '输入框',
  },
  field: {
    text: '文字',
    label: '文字',
    src: '来源',
    alt: '替代文字',
    href: '地址',
    newTab: '在新标签页打开',
    placeholder: '占位提示',
  },
  tweak: '由 Tweak「{{name}}」设置：改它，用到它的地方一起变。',
  readonly: {
    data: '来自画板脚本里的数据，不能在这里改。告诉 Claude，或到代码里改。',
    row: '来自列表的某一行，不能在这里改。告诉 Claude，或改列表的数据。',
  },
  picture: {
    replace: '替换…',
    upload: '上传图片…',
    uploading: '正在上传…',
    noneYet: '项目里还没有图片。',
    pick: '用 {{name}}',
    current: '当前图片',
    preview: '{{src}} 的预览',
    uploadFailed: '图片没能上传：{{message}}',
  },
} satisfies Locale<typeof en>;
