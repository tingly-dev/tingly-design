/**
 * One-click PDF. A page the editor built (a deck one slide per page, a doc) is printed by the
 * server's Chrome and saved straight away. A machine with no Chrome falls back to the browser's
 * print window, where the person picks Save as PDF; the menu says which of the two will happen.
 */
import { useEffect, useState } from 'react';
import { download } from './local';
import { api } from './api';
import { t } from './i18n';
import { toast } from './store';

let chrome: Promise<boolean> | null = null;
/** Does the machine behind the server have a Chrome or Edge to print with? Asked once. */
const hasChrome = () => (chrome ??= api.renderCapabilities().then((c) => c.chrome, () => false));

/** `true` / `false` once known; `null` while asking, when the menu should not promise either. */
export function useDirectPdf(): boolean | null {
  const [v, setV] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void hasChrome().then((c) => live && setV(c));
    return () => {
      live = false;
    };
  }, []);
  return v;
}

/** The hint under a PDF item: what is in it, and that it opens the print dialog when it has to. */
export const pdfHint = (what: string, direct: boolean | null) => (direct === false ? t('common.transfer.viaPrint', { what }) : what);

/** Make the PDF and save it as `name`; `print` is the way out on a machine with no Chrome (it gets a page with no auto-print script). */
export async function savePdf(name: string, o: { html: string; paper: 'page' | 'a4'; print: () => void | Promise<void> }): Promise<void> {
  if (!(await hasChrome())) return o.print();
  try {
    download(name, await api.renderPdf(o.html, o.paper));
    toast(t('common.transfer.saved', { name }));
  } catch (e) {
    toast(t('common.transfer.pdfFailed', { message: (e as Error).message }), 'error');
  }
}

/** The print window: the page is written into a new tab. `autoPrint` adds the script that opens the print dialog once it has loaded (a page that already carries one does not need it). */
export function printWindow(html: string, autoPrint = false): boolean {
  const w = window.open('', '_blank');
  if (!w) {
    toast(t('common.transfer.popupBlocked'), 'error');
    return false;
  }
  const page = autoPrint ? html.replace(/<\/body>/i, '<script>addEventListener("load",function(){setTimeout(function(){print()},800)})</script></body>') : html;
  w.document.open();
  w.document.write(page);
  w.document.close();
  return true;
}
