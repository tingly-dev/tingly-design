import type en from '../en/prompt';
import type { Locale } from '../../types';

export default {
  step: {
    readSkill: '读格式说明',
    read: '读 {{target}}',
    glob: '找文件 {{target}}',
    grep: '搜索“{{target}}”',
    grepIn: '搜索“{{target}}”（{{within}}）',
    write: '写 {{target}}',
    edit: '改 {{target}}',
    query: '查询数据',
    run: '运行 {{target}}',
    plan: '列出步骤',
    tool: '{{target}}',
  },
  elapsed: {
    seconds: '{{s}} 秒',
    minutes: '{{m}} 分 {{ss}} 秒',
  },
} satisfies Locale<typeof en>;
