import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { IconFileTypeCsv } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { gridToCsv } from '@dc/core';
import { CornerBar, type CornerItem } from '../CornerBar';
import { CopyPicture, Picture } from '../icons';
import { copyImage, fileStem, nodeToPng, opaque, saveImage } from '../../imageExport';
import { download } from '../../local';
import { t as tNow } from '../../i18n';
import { docEditor } from './DocEditor';
import { useDocIndex } from './docs';
import { kindOfFence } from './richCode';

/**
 * The corner bar on the block the cursor is in: a table, or a fence that draws itself
 * (a csv/tsv table, a mermaid diagram, a formula). Its export actions sit at the block's
 * corner instead of in the top bar — the bar adds an entry point, it does not move one
 * (the toolbar keeps its editing actions). See .design/block-corner-bar.md.
 */

type ActiveBlock = {
  /** what the bar hangs on: the whole block */
  anchor: HTMLElement;
  /** what a picture is drawn from: the result (the `.rc-view`), not the source beside it */
  png: HTMLElement;
  /** set for a fence that draws itself, with its language and source text */
  fence: { language: string; source: string } | null;
};

/** The block the cursor is in, if it is one this bar serves; null for everything else. */
function activeBlock(e: Editor): ActiveBlock | null {
  const { $from } = e.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    const dom = e.view.nodeDOM($from.before(d)) as HTMLElement | null;
    if (!dom) continue;
    if (n.type.name === 'table') return { anchor: dom, png: dom, fence: null };
    if (n.type.name === 'codeBlock') {
      const language = String(n.attrs.language ?? '');
      if (!kindOfFence(language) || dom.classList.contains('rc-error')) return null;
      const view = dom.querySelector<HTMLElement>('.rc-view');
      // nothing drawn yet, nothing to hand over
      if (!view || !view.firstElementChild) return null;
      return { anchor: dom, png: view, fence: { language, source: n.textContent } };
    }
  }
  return null;
}

/** The table the cursor is in, as a .csv file (UTF-8 with a mark so spreadsheets read Chinese right). */
export function downloadTableCsv(e: Editor, name = 'table.csv'): void {
  const { $from } = e.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const table = $from.node(depth);
    if (table.type.name !== 'table') continue;
    const grid: string[][] = [];
    let hasHeader = false;
    table.forEach((row, _o, r) => {
      if (r === 0) hasHeader = row.firstChild?.type.name === 'tableHeader';
      const cells: string[] = [];
      row.forEach((cell) => cells.push(cell.textBetween(0, cell.content.size, '\n', '\n')));
      grid.push(cells);
    });
    download(name, '\ufeff' + gridToCsv(grid, hasHeader), 'text/csv;charset=utf-8');
    return;
  }
}

const SLUGS = { math: 'formula', table: 'table', diagram: 'diagram' } as const;

function blockItems(e: Editor, block: ActiveBlock, stem: string): CornerItem[] {
  const kind = block.fence ? kindOfFence(block.fence.language)! : 'table';
  const base = `${stem}-${SLUGS[kind]}`;
  const items: CornerItem[] = [];
  if (block.fence) {
    const ext = block.fence.language.toLowerCase() === 'tsv' ? 'tsv' : 'csv';
    // the fence's source is the data itself: hand it over as it stands
    items.push({
      id: 'csv',
      label: tNow('docs.toolbar.tableCsv'),
      icon: <IconFileTypeCsv size={16} stroke={1.7} aria-hidden="true" />,
      run: () => download(`${base}.${ext}`, '\ufeff' + block.fence!.source, ext === 'tsv' ? 'text/tab-separated-values;charset=utf-8' : 'text/csv;charset=utf-8'),
    });
  } else {
    items.push({
      id: 'csv',
      label: tNow('docs.toolbar.tableCsv'),
      icon: <IconFileTypeCsv size={16} stroke={1.7} aria-hidden="true" />,
      run: () => downloadTableCsv(e, `${base}.csv`),
    });
  }
  const make = () => nodeToPng(block.png, { backgroundColor: opaque(getComputedStyle(block.png).backgroundColor, getComputedStyle(document.body).backgroundColor) });
  items.push({
    id: 'copy-png',
    label: tNow('docs.blockbar.copyPng'),
    icon: <CopyPicture />,
    run: () => void copyImage(`${base}.png`, make),
  });
  items.push({
    id: 'png',
    label: tNow('docs.blockbar.savePng'),
    icon: <Picture />,
    run: () => void saveImage(`${base}.png`, make),
  });
  return items;
}

export function BlockBar() {
  const { t } = useTranslation();
  const [, force] = useState(0);
  const title = useDocIndex().title;
  useEffect(() => {
    const e = docEditor.current;
    if (!e) return;
    const f = () => force((n) => n + 1);
    e.on('transaction', f);
    return () => {
      e.off('transaction', f);
    };
  });
  const e = docEditor.current;
  const block = e ? activeBlock(e) : null;
  const stem = fileStem(title, 'doc');
  return <CornerBar anchor={block?.anchor ?? null} items={block ? blockItems(e!, block, stem) : []} label={t('docs.blockbar.label')} />;
}
