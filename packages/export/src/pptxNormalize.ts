import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { bytesEqual, type PptxTablePatch } from './pptx';

/** Only for this writer's freshly generated PptxGenJS 4.0.1 package, never imported OOXML.
 * Byte-for-byte XML edits retain all run/notes/media content. Fail closed if the pinned
 * generator's known vocabulary changes; this is not a general OOXML repair facility.
 * `patches` add what 4.0.1 cannot write: `cmpd="dbl"` borders and diagonal `<a:lnTlToBr>`/
 * `<a:lnBlToTr>` in table cells; `fallbacks` replace the PNG stand-in of an SVG asset with the
 * caller's own rendering (4.0.1 draws a loose one in the browser and a broken one in Node). */
export function normalizePptx401(bytes: Uint8Array, slideCount: number, patches: PptxTablePatch[] = [], fallbacks: { svg: Uint8Array; png: Uint8Array }[] = []): Uint8Array {
  const parts = unzipSync(bytes);
  const unexpected = (): never => { throw new Error('pptx: unexpected PptxGenJS 4.0.1 package structure'); };
  const read = (name: string) => parts[name] ? strFromU8(parts[name]) : unexpected();
  const put = (name: string, value: string) => { parts[name] = strToU8(value); };
  if (Object.keys(parts).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length !== slideCount) unexpected();
  if (!parts['ppt/slideMasters/slideMaster1.xml'] || Object.keys(parts).filter(n => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(n)).length !== 1) unexpected();

  // CT_Presentation: sldMasterIdLst, notesMasterIdLst, sldIdLst, sldSz.
  const presentation = read('ppt/presentation.xml');
  const sequence = /(<\/p:sldMasterIdLst>)(<p:sldIdLst>(?:<p:sldId id="\d+" r:id="rId\d+"\/>)+<\/p:sldIdLst>)(<p:notesMasterIdLst><p:notesMasterId r:id="rId\d+"\/><\/p:notesMasterIdLst>)(?=<p:sldSz )/g;
  if ([...presentation.matchAll(sequence)].length !== 1 || (presentation.match(/<p:notesMasterIdLst>/g) ?? []).length !== 1) unexpected();
  put('ppt/presentation.xml', presentation.replace(sequence, '$1$3$2'));

  // 4.0.1 declares one master per slide but writes only master1. Remove exactly
  // master2..N's known overrides, and only when their parts really do not exist.
  let types = read('[Content_Types].xml');
  for (let i = 2; i <= slideCount; i++) {
    const part = `ppt/slideMasters/slideMaster${i}.xml`;
    const tag = `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`;
    if (parts[part] || types.split(tag).length !== 2) unexpected();
    types = types.replace(tag, '');
  }
  for (const match of types.matchAll(/<Override PartName="\/([^"<>]+)"[^<>]*\/>/g)) if (!parts[match[1]]) unexpected();
  put('[Content_Types].xml', types);

  for (let i = 1; i <= slideCount; i++) {
    const name = `ppt/slides/slide${i}.xml`;
    put(name, read(name).replace(/<a:p>.*?<\/a:p>/g, paragraph => {
      const properties = paragraph.match(/<a:pPr\b[^>]*>.*?<\/a:pPr>/g) ?? [];
      if ((paragraph.match(/<a:pPr\b/g) ?? []).length !== properties.length) unexpected();
      if (!properties.length) return paragraph; // empty shape paragraph
      if (!paragraph.startsWith(`<a:p>${properties[0]}`) || !properties.every(p => p === properties[0])) unexpected();
      let seen = false;
      return paragraph.replace(/<a:pPr\b[^>]*>.*?<\/a:pPr>/g, tag => { if (seen) return ''; seen = true; return tag; });
    }));
  }

  // Table borders the generator cannot express, one slide at a time, in the order written.
  const bySlide = new Map<number, PptxTablePatch[]>();
  for (const p of patches) { const list = bySlide.get(p.slide) ?? []; list.push(p); bySlide.set(p.slide, list); }
  for (const [slide, list] of bySlide) {
    const name = `ppt/slides/slide${slide + 1}.xml`;
    let xml = read(name);
    const tables = [...xml.matchAll(/<a:tbl>(.*?)<\/a:tbl>/gs)];
    const byTable = new Map<number, PptxTablePatch[]>();
    for (const p of list) { const cell = byTable.get(p.table) ?? []; cell.push(p); byTable.set(p.table, cell); }
    for (const [table, cells] of [...byTable].reverse()) {
      if (table >= tables.length) unexpected();
      const tbl = tables[table][1];
      const tcs = tbl.match(/<a:tc(?:\s[^>]*)?>.*?<\/a:tc>/gs) ?? unexpected();
      let next = tbl;
      for (const patch of [...cells].reverse()) {
        if (patch.cell >= tcs.length) unexpected();
        next = next.replace(tcs[patch.cell], () => patchCell(tcs[patch.cell], patch));
      }
      xml = xml.replace(tbl, () => next);
    }
    put(name, xml);
  }

  // The writer's SVG assets carry their rendered PNG stand-in: 4.0.1 writes the SVG bytes as
  // both media parts (a broken image in Node, its own rendering in the browser), so the `.png`
  // part holding a known asset's exact SVG bytes is replaced with that asset's stand-in.
  if (fallbacks.length) {
    for (const name of Object.keys(parts)) {
      if (!/^ppt\/media\/.+\.png$/.test(name)) continue;
      const found = fallbacks.find(f => bytesEqual(f.svg, parts[name]!));
      if (found) parts[name] = found.png.slice();
    }
  }
  return zipSync(parts, { level: 6 });
}

/** Double borders become `cmpd="dbl"` on the written line; diagonals join the line children of
 * `<a:tcPr>` (CT_TableCellProperties: lnL, lnR, lnT, lnB, lnTlToBr, lnBlToTr, then the fill). */
function patchCell(tc: string, patch: PptxTablePatch): string {
  const unexpected = (): never => { throw new Error('pptx: unexpected PptxGenJS 4.0.1 table cell'); };
  let next = tc;
  const sides = ['lnT', 'lnR', 'lnB', 'lnL'];
  for (const [s, double] of patch.double.entries()) {
    if (!double) continue;
    const open = new RegExp(`<a:${sides[s]}(?:\\s[^>]*)?>`).exec(next)?.[0];
    if (!open || !/cmpd="sng"/.test(open)) return unexpected();
    const fixed = open.replace('cmpd="sng"', 'cmpd="dbl"');
    next = next.replace(open, () => fixed);
  }
  const diagonal = (which: 'lnTlToBr' | 'lnBlToTr', d: { color: string; emu: number }) =>
    `<a:${which} w="${d.emu}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="${d.color}"/></a:solidFill><a:prstDash val="solid"/></a:${which}>`;
  const last = [...next.matchAll(/<\/a:ln[TRLB]>/g)].at(-1);
  const insert = [patch.tl2br ? diagonal('lnTlToBr', patch.tl2br) : '', patch.tr2bl ? diagonal('lnBlToTr', patch.tr2bl) : ''].join('');
  if (insert) next = last ? next.replace(last[0], () => `${last[0]}${insert}`) : next.replace(/<a:tcPr(?:\s[^>]*)?>/, open => `${open}${insert}`);
  if (next === tc) unexpected();
  return next;
}
