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
} satisfies Locale<typeof en>;
