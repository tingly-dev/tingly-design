import { useRef } from 'react';
import { ATTACH_ACCEPT } from '@dc/core';
import type { Attached } from '../attachments';
import { Clip, Close, FilePdf, FileText } from './icons';

function size(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** The files on a request, as chips: a thumbnail or a file icon, the name, and × to take one off. */
export function AttachTray({ items, onRemove }: { items: Attached[]; onRemove: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="attach-tray" aria-label="附件">
      {items.map((a) => (
        <li key={a.key} className={`attach-chip ${a.kind}`} title={`${a.name} · ${size(a.size)}`}>
          {a.preview ? <img src={a.preview} alt="" /> : <span className="ico">{a.kind === 'pdf' ? <FilePdf /> : <FileText />}</span>}
          <span className="name">{a.name}</span>
          <button className="x" aria-label={`移除 ${a.name}`} onClick={() => onRemove(a.key)}>
            <Close />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The paperclip: opens the file picker. */
export function AttachButton({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="ib attach" title="附加图片或文件（也可以粘贴或拖进来）" aria-label="附加图片或文件" disabled={disabled} onClick={() => input.current?.click()}>
        <Clip />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={ATTACH_ACCEPT}
        aria-label="选择附件"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
    </>
  );
}
