/** Hands a file to the browser's Save dialog. */
export function download(name: string, blob: Blob | string): void {
  const url = typeof blob === 'string' ? blob : URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  if (typeof blob !== 'string') setTimeout(() => URL.revokeObjectURL(url), 5000);
}
