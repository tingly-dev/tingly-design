import type en from '../en/appearance';
import type { Locale } from '../../types';

export default {
  title: '外观',
  titleWith: '外观：{{name}}',
  theme: '主题',
  language: '语言',
  languageWith: '语言：{{name}}',
  mode: {
    system: '跟随系统',
    systemHint: '浅色 / 深色',
    light: '浅色',
    dark: '深色',
    claude: 'Claude',
    ds: 'DeepSeek',
    sunlit: 'Sunlit',
  },
  custom: '外部主题',
  source: {
    host: '宿主传入',
    url: '链接传入',
    server: 'DC_THEME',
  },
} satisfies Locale<typeof en>;
