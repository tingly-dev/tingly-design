import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { ATTACH_LIMITS, attachmentKind, type Attachment } from '@dc/core';
import { toast } from './store';

/**
 * Files and images attached to a request, read in the browser: images are
 * scaled down to what the model looks at, text files are read as text and
 * PDFs go as they are. Nothing is uploaded to the project.
 */

/** An attachment on its way, with a preview for the chip. */
export interface Attached extends Attachment {
  key: string;
  /** an object URL for an image's thumbnail */
  preview?: string;
  /** bytes as sent */
  size: number;
}

function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** An image as the model gets it: scaled so its longest side is at most 1568 px, re-encoded only when it had to shrink or is too big. */
async function fitImage(file: Blob, mediaType: string): Promise<{ blob: Blob; mediaType: string }> {
  // GIFs keep their frames; the model reads the first
  if (mediaType === 'image/gif') return { blob: file, mediaType };
  const img = await loadImage(file);
  const k = Math.min(1, ATTACH_LIMITS.imageSide / Math.max(img.naturalWidth, img.naturalHeight));
  if (k === 1 && file.size <= ATTACH_LIMITS.imageBytes) return { blob: file, mediaType };
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  // WebP keeps transparency and stays small
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.9));
  if (!blob) throw new Error('图片转换失败');
  return { blob, mediaType: blob.type || 'image/webp' };
}

let seq = 0;

/** Reads one file into an attachment, or throws with the reason in words. */
export async function readAttachment(file: File): Promise<Attached> {
  const name = file.name || (file.type.startsWith('image/') ? `粘贴的图片.${file.type.slice(6).replace('jpeg', 'jpg')}` : 'file');
  const k = attachmentKind(name, file.type);
  if (!k) throw new Error(`不支持这种文件：${name}（可以附图片、PDF 和文本文件）`);
  const key = `a${++seq}`;
  if (k.kind === 'image') {
    const { blob, mediaType } = await fitImage(file, k.mediaType);
    if (blob.size > ATTACH_LIMITS.imageBytes) throw new Error(`${name} 超过 5 MB`);
    const sent = mediaType === k.mediaType ? name : name.replace(/\.[^.]+$/, '') + '.webp';
    return { key, name: sent, kind: 'image', mediaType, data: base64(await blob.arrayBuffer()), size: blob.size, preview: URL.createObjectURL(blob) };
  }
  if (k.kind === 'pdf') {
    if (file.size > ATTACH_LIMITS.pdfBytes) throw new Error(`${name} 超过 10 MB`);
    return { key, name, kind: 'pdf', mediaType: k.mediaType, data: base64(await file.arrayBuffer()), size: file.size };
  }
  const text = await file.text();
  if (text.length > ATTACH_LIMITS.textChars) throw new Error(`${name} 太长（超过 ${ATTACH_LIMITS.textChars / 1000}k 字符）`);
  return { key, name, kind: 'text', mediaType: k.mediaType, data: text, size: file.size };
}

/** Just the part that travels with a request. */
export function toSend(list: Attached[]): Attachment[] {
  return list.map(({ name, kind, mediaType, data }) => ({ name, kind, mediaType, data }));
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
}

/**
 * A request's attachments, and the handlers that add them: pasting an image
 * or a file, dropping files, or the file picker.
 */
export function useAttachments() {
  const [items, setItems] = useState<Attached[]>([]);
  const [over, setOver] = useState(false);

  // the list as it is now, for adds that finish one after another before a render
  const live = useRef<Attached[]>([]);
  const put = useCallback((next: Attached[]) => {
    live.current = next;
    setItems(next);
  }, []);

  const add = useCallback(
    async (files: Iterable<File>) => {
      for (const f of files) {
        if (live.current.length >= ATTACH_LIMITS.count) {
          toast(`一次最多附 ${ATTACH_LIMITS.count} 个文件`, 'error');
          return;
        }
        try {
          const a = await readAttachment(f);
          if (live.current.length >= ATTACH_LIMITS.count) {
            if (a.preview) URL.revokeObjectURL(a.preview);
            toast(`一次最多附 ${ATTACH_LIMITS.count} 个文件`, 'error');
            return;
          }
          put([...live.current, a]);
        } catch (e) {
          toast((e as Error).message, 'error');
        }
      }
    },
    [put],
  );

  const remove = useCallback(
    (key: string) => {
      const gone = live.current.find((a) => a.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      put(live.current.filter((a) => a.key !== key));
    },
    [put],
  );

  /** After sending: the chips go, their previews are released. */
  const clear = useCallback(() => {
    for (const a of live.current) if (a.preview) URL.revokeObjectURL(a.preview);
    put([]);
  }, [put]);

  const handlers = {
    onPaste: (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData.files);
      if (!files.length) return;
      // cells or a paragraph copied from an office app come with a picture of themselves: the text wins
      const d = e.clipboardData;
      if (d.getData('text/plain').trim() && d.types.includes('text/html') && files.every((f) => f.type.startsWith('image/'))) return;
      e.preventDefault();
      e.stopPropagation();
      void add(files);
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setOver(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setOver(false);
    },
    onDrop: (e: DragEvent) => {
      setOver(false);
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      e.stopPropagation();
      void add(Array.from(e.dataTransfer.files));
    },
  };

  return { items, over, add, remove, clear, handlers };
}
