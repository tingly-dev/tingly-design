/** Claude Design 包：保存或打开之后，要让人知道的事（.design/claude-design-format.md）。 */
export default {
  kind: {
    design: 'Design',
    slides: 'Slides',
    'design-system': 'Design System',
    dashboard: 'Dashboard',
    docs: 'Docs',
  },
  note: {
    missingPictures: '包里缺少 {{count}} 张图片，它们仍指向 /_blob 链接。把这件作品的素材存在 project/ 旁边，再导入一次。',
    missingData: '包里缺少 {{count}} 个数据文件，这些数据集在接上文件之前没有数据。',
    connector: '有数据集在查询 {{names}}，另一边未必有这个连接器。请换成附加的文件，或另一边有的连接器。',
    localSystem: '索引里写的设计系统在本机，不在 claude.ai 上。发布之前请装入真正的那一个。',
    slidePictures: '幻灯片里的 {{count}} 张图片是 uploads/ 下的文件。发布前要先作为素材上传，README 里写了怎么做。',
    sqlite: '本地的 SQLite 数据库没有带上，因为原版 Dashboard 读不了它。',
  },
};
