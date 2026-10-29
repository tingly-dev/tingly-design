import { DOC_COLORS, DOC_INDEX, parseDoc } from '@dc/core';
import { markdownToDocx, type DocxOptions } from '@dc/export/docx';
import { download } from '../../local';
import { t } from '../../i18n';
import { display, toast, useStore } from '../../store';
import { docMarkdown, fetchPictures } from './markdownExport';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** An SVG drawn to a PNG at twice its size (Word has no SVG it can rely on), kept at its own size on the page. */
async function svgToPng(svg: Uint8Array): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  const url = URL.createObjectURL(new Blob([svg as BlobPart], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const width = img.naturalWidth || 800;
    const height = img.naturalHeight || 600;
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
    return png ? { bytes: new Uint8Array(await png.arrayBuffer()), width, height } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Saves the whole doc as a Word file (.docx), made here from the same Markdown the Markdown export
 * writes (.design/docs-docx.md). Pictures go in; one that cannot be read stays as its description, said in a toast.
 */
export async function saveDocWord(name: string): Promise<void> {
  const { markdown, images } = docMarkdown();
  const settings = parseDoc(display(useStore.getState(), DOC_INDEX)).settings;
  const got = await fetchPictures(images);
  const pictures: NonNullable<DocxOptions['images']> = new Map();
  let missing = 0;
  await Promise.all(
    images.map(async (path, i) => {
      const data = got[i];
      const done = data ? (/\.svg$/i.test(path) ? await svgToPng(data) : data) : null;
      if (done) pictures.set(path, done);
      else missing++;
    }),
  );
  const bytes = markdownToDocx(markdown, { title: name, lang: settings.lang, headingFont: settings.headingFont, bodyFont: settings.bodyFont, images: pictures, colors: DOC_COLORS });
  download(`${name}.docx`, new Blob([bytes as BlobPart], { type: DOCX }), DOCX);
  if (missing) toast(t('docs.export.missingWord', { count: missing }), 'error');
}
