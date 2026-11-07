/** 批阅：在页面上写批注，一次交给 Claude Code（.design/review-remarks.md）。 */
export default {
  pane: {
    label: '批阅',
    hint: '批阅：在页面上逐处写批注，最后一次全部交出去',
  },
  title: '批阅',
  count_other: '{{count}} 条批注',
  countNone: '还没有批注',
  clear: '清空',
  close: '结束批阅',
  empty: {
    title: '点页面上的任何地方',
    body: '给它写一条批注。点空白处就是给整页写。',
    more: '想写多少写多少，最后一起交给 Claude Code。',
  },
  whole: '整页',
  placeholder: '这里要改什么？',
  textLabel: '批注 {{n}}',
  remove: '删除批注 {{n}}',
  removedName: '批注 {{n}}',
  clearedName_other: '{{count}} 条批注',
  show: '在页面上显示',
  lost: '这个元素变了。你写的话还在；Claude Code 会拿到它最后一次的源码。',
  send_other: '把 {{count}} 条批注交给 Claude Code',
  sendNone: '交给 Claude Code',
  busy: 'Claude Code 还在处理上一条请求',
  unsent_other: '{{count}} 条批注没写字，留在这里',
};
