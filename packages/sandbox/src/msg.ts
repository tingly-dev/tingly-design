/**
 * The few words the sandbox itself says inside a frame (an error banner), in the editor's
 * language. The frames are opaque-origin IIFEs, so no i18next here: a two-language table, the
 * language read from the frame's `<html lang>` (the editor writes it there), else the browser's,
 * else English. The editor's own strings live in @dc/i18n.
 */
const MESSAGES = {
  en: {
    pageStopped: "This page's code stopped ({{file}}): {{message}}",
    script: 'script',
    fileFailed: '{{file}} failed',
  },
  zh: {
    pageStopped: '这个页面的代码停止了（{{file}}）：{{message}}',
    script: '脚本',
    fileFailed: '{{file}} 出错了',
  },
} satisfies Record<string, Record<string, string>>;

export type MsgKey = keyof (typeof MESSAGES)['en'];

function lang(): keyof typeof MESSAGES {
  const tag = (document.documentElement.lang || navigator.language || '').toLowerCase();
  return tag === 'zh' || tag.startsWith('zh-') ? 'zh' : 'en';
}

export function msg(key: MsgKey, vars: Record<string, string> = {}): string {
  return MESSAGES[lang()][key].replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
}
