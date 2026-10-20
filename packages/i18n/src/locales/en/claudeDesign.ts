/** Claude Design packages: what the person should know after saving or opening one (.design/claude-design-format.md). */
export default {
  kind: {
    design: 'Design',
    slides: 'Slides',
    'design-system': 'Design System',
    dashboard: 'Dashboard',
    docs: 'Docs',
  },
  note: {
    missingPictures: 'Pictures the package does not carry: {{count}}. They keep their /_blob links; save the artifact’s assets next to project/ and import again.',
    missingData: 'Data files the package does not carry: {{count}}. Those datasets show no rows until a file is attached.',
    connector: 'Some datasets query {{names}}, which may not exist on the other side. Replace them with an attached file or a connector that does.',
    localSystem: 'The index names a design system that lives here, not on claude.ai. Install the real one before publishing.',
    slidePictures: 'Slide pictures ({{count}}) are files under uploads/. They must be uploaded as assets before the deck is published; the README says how.',
    sqlite: 'A local SQLite database was left out, because the original Dashboard cannot read one.',
  },
};
