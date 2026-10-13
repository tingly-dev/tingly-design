import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { ATTACH_LIMITS, attachmentKind, type Attachment } from '@dc/core';
import { api } from './api';
import { toast } from './store';
import { t } from './i18n';

/**
 * Files and images attached to a request. In the browser they are read for
 * the model (images scaled down to what it looks at, text files as text,
 * PDFs as they are); when the request is sent, each one is kept in the
 * project's uploads/ folder as the person gave it, so later requests and
 * Claude Code can use it again.
 */

/** An attachment on its way, with a preview for the chip. */
export interface Attached extends Attachment {
  key: string;
  /** an object URL for an image's thumbnail */
  preview?: string;
  /** bytes as sent to the model */
  size: number;
  /** what is kept in the project: the file itself, or the scaled copy when the file is too big to keep */
  keep: File;
}

/** The server keeps files up to this size (MAX_ASSET). */
const KEEP_BYTES = 20 * 1024 * 1024;

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
  if (!blob) throw new Error(t('app.attach.convertFailed'));
  return { blob, mediaType: blob.type || 'image/webp' };
}

let seq = 0;

/** Reads one file into an attachment, or throws with the reason in words. */
export async function readAttachment(file: File): Promise<Attached> {
  const pasted = !file.name;
  const ext = file.type.slice(file.type.indexOf('/') + 1).replace('jpeg', 'jpg');
  const name = pasted ? (file.type.startsWith('image/') ? `${t('app.attach.pastedImage')}.${ext}` : 'file') : file.name;
  // a pasted image has no name: it is kept as pasted-<hash>.png
  const k = attachmentKind(name, file.type);
  if (!k) throw new Error(t('app.attach.unsupported', { name }));
  const key = `a${++seq}`;
  if (k.kind === 'image') {
    const { blob, mediaType } = await fitImage(file, k.mediaType);
    if (blob.size > ATTACH_LIMITS.imageBytes) throw new Error(t('app.attach.tooLarge', { name, size: '5 MB' }));
    const keepName = pasted || !attachmentKind(name) ? `${pasted ? 'pasted' : name}.${ext}` : name;
    const keep = file.size <= KEEP_BYTES ? new File([file], keepName, { type: file.type }) : new File([blob], keepName.replace(/\.[^.]+$/, '') + '.webp', { type: mediaType });
    return { key, name, kind: 'image', mediaType, data: base64(await blob.arrayBuffer()), size: blob.size, preview: URL.createObjectURL(blob), keep };
  }
  if (k.kind === 'pdf') {
    if (file.size > ATTACH_LIMITS.pdfBytes) throw new Error(t('app.attach.tooLarge', { name, size: '10 MB' }));
    return { key, name, kind: 'pdf', mediaType: k.mediaType, data: base64(await file.arrayBuffer()), size: file.size, keep: file };
  }
  const text = await file.text();
  if (text.length > ATTACH_LIMITS.textChars) throw new Error(t('app.attach.tooLong', { name, k: ATTACH_LIMITS.textChars / 1000 }));
  // kept under a name the server knows the kind of
  const keepName = /\.[A-Za-z0-9]+$/.test(name) && attachmentKind(name) ? name : `${name}.txt`;
  return { key, name, kind: 'text', mediaType: k.mediaType, data: text, size: file.size, keep: new File([file], keepName, { type: file.type || 'text/plain' }) };
}

/**
 * Keeps each attachment in the project's uploads/ (named by content, so a
 * file sent twice is kept once) and returns what travels with the request,
 * each with the path it is kept at. Throws when one cannot be kept.
 */
export async function keepAttachments(project: string, list: Attached[]): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const { name, kind, mediaType, data, keep } of list) {
    const { path } = await api.upload(project, keep, 'uploads');
    out.push({ name, kind, mediaType, data, path });
  }
  return out;
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
          toast(t('app.attach.tooMany', { count: ATTACH_LIMITS.count }), 'error');
          return;
        }
        try {
          const a = await readAttachment(f);
          if (live.current.length >= ATTACH_LIMITS.count) {
            if (a.preview) URL.revokeObjectURL(a.preview);
            toast(t('app.attach.tooMany', { count: ATTACH_LIMITS.count }), 'error');
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
