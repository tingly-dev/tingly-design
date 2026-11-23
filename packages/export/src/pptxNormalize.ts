import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { bytesEqual, type PptxDeckPatch, type PptxTablePatch } from './pptx';

/** Only for this writer's freshly generated PptxGenJS 4.0.1 package, never imported OOXML.
 * Byte-for-byte XML edits retain all run/notes/media content. Fail closed if the pinned
 * generator's known vocabulary changes; this is not a general OOXML repair facility.
 * `patches` add what 4.0.1 cannot write: `cmpd="dbl"` borders and diagonal `<a:lnTlToBr>`/
 * `<a:lnBlToTr>` in table cells; `fallbacks` replace the PNG stand-in of an SVG asset with the
 * caller's own rendering (4.0.1 draws a loose one in the browser and a broken one in Node). `deck` adds what 4.0.1
 * has no option for: the title placeholder (on the slide, with one on the master and layout to inherit from),
 * PowerPoint sections and the theme's colour scheme. */
export function normalizePptx401(bytes: Uint8Array, slideCount: number, patches: PptxTablePatch[] = [], fallbacks: { svg: Uint8Array; png: Uint8Array }[] = [], deck: PptxDeckPatch = { titles: [], sections: [], colors: {} }): Uint8Array {
  const parts = unzipSync(bytes);
  const unexpected = (where = 'part'): never => { throw new Error(`pptx: unexpected PptxGenJS 4.0.1 package structure (${where})`); };
  const read = (name: string) => parts[name] ? strFromU8(parts[name]) : unexpected();
  const put = (name: string, value: string) => { parts[name] = strToU8(value); };
  if (Object.keys(parts).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length !== slideCount) unexpected('slides');
  if (!parts['ppt/slideMasters/slideMaster1.xml'] || Object.keys(parts).filter(n => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(n)).length !== 1) unexpected('master');

  // CT_Presentation: sldMasterIdLst, notesMasterIdLst, sldIdLst, sldSz.
  const presentation = read('ppt/presentation.xml');
  const sequence = /(<\/p:sldMasterIdLst>)(<p:sldIdLst>(?:<p:sldId id="\d+" r:id="rId\d+"\/>)+<\/p:sldIdLst>)(<p:notesMasterIdLst><p:notesMasterId r:id="rId\d+"\/><\/p:notesMasterIdLst>)(?=<p:sldSz )/g;
  if ([...presentation.matchAll(sequence)].length !== 1 || (presentation.match(/<p:notesMasterIdLst>/g) ?? []).length !== 1) unexpected('presentation');
  let ordered = presentation.replace(sequence, '$1$3$2');
  if (deck.sections.length) {
    // the p14 section list (PowerPoint 2010), in the presentation's extension list, naming every slide id in order
    const ids = [...ordered.matchAll(/<p:sldId id="(\d+)" r:id="rId\d+"\/>/g)].map(m => m[1]);
    if (ids.length !== slideCount || ordered.includes('<p:extLst>') || !ordered.endsWith('</p:presentation>') || deck.sections.reduce((n, x) => n + x.slides, 0) !== slideCount) unexpected('sections');
    let at = 0;
    const list = deck.sections.map((section, i) => {
      const slides = ids.slice(at, at += section.slides).map(id => `<p14:sldId id="${id}"/>`).join('');
      return `<p14:section name="${xml(section.name)}" id="{${(i + 1).toString(16).toUpperCase().padStart(8, '0')}-0000-4000-8000-000000000000}"><p14:sldIdLst>${slides}</p14:sldIdLst></p14:section>`;
    }).join('');
    ordered = ordered.replace(/<\/p:presentation>$/, `<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">${list}</p14:sectionLst></p:ext></p:extLst></p:presentation>`);
  }
  put('ppt/presentation.xml', ordered);

  if (Object.keys(deck.colors).length) {
    const name = 'ppt/theme/theme1.xml';
    let theme = read(name);
    const scheme = /<a:clrScheme name="Office">.*?<\/a:clrScheme>/s.exec(theme)?.[0] ?? unexpected('theme');
    let next = scheme;
    for (const [key, value] of Object.entries(deck.colors)) {
      const slot = new RegExp(`<a:${key}>(?:<a:srgbClr val="[0-9A-F]{6}"/>|<a:sysClr val="\\w+" lastClr="[0-9A-F]{6}"/>)</a:${key}>`);
      if (!slot.test(next)) unexpected('theme');
      next = next.replace(slot, `<a:${key}><a:srgbClr val="${value.toUpperCase()}"/></a:${key}>`);
    }
    theme = theme.replace(scheme, () => next);
    put(name, theme);
  }

  if (deck.titles.length) {
    // a title placeholder on the master, and one on the layout that inherits it: the slide's own placeholder
    // keeps its position and text; these are where PowerPoint's "Reset" puts it
    const [x, y, cx, cy] = deck.titles[0].box;
    const master = 'ppt/slideMasters/slideMaster1.xml', layout = 'ppt/slideLayouts/slideLayout1.xml';
    const placeholder = (spPr: string) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>${spPr}<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;
    for (const [part, spPr] of [[master, `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`], [layout, '<p:spPr/>']]) {
      const value = read(part);
      const tree = /<p:spTree><p:nvGrpSpPr>.*?<\/p:grpSpPr>/s.exec(value)?.[0];
      if (!tree || value.includes('<p:ph ')) unexpected('title-master');
      put(part, value.replace(tree!, () => tree + placeholder(spPr)));
    }
  }
  const titled = new Map(deck.titles.map(t => [t.slide, t.name]));

  // 4.0.1 declares one master per slide but writes only master1. Remove exactly
  // master2..N's known overrides, and only when their parts really do not exist.
  let types = read('[Content_Types].xml');
  for (let i = 2; i <= slideCount; i++) {
    const part = `ppt/slideMasters/slideMaster${i}.xml`;
    const tag = `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`;
    if (parts[part] || types.split(tag).length !== 2) unexpected('content-types');
    types = types.replace(tag, '');
  }
  for (const match of types.matchAll(/<Override PartName="\/([^"<>]+)"[^<>]*\/>/g)) if (!parts[match[1]]) unexpected('content-types');
  put('[Content_Types].xml', types);

  for (let i = 1; i <= slideCount; i++) {
    const name = `ppt/slides/slide${i}.xml`;
    let slideXml = read(name).replace(/<a:p>.*?<\/a:p>/g, paragraph => {
      const properties = paragraph.match(/<a:pPr\b[^>]*>.*?<\/a:pPr>/g) ?? [];
      if ((paragraph.match(/<a:pPr\b/g) ?? []).length !== properties.length) unexpected('paragraph');
      if (!properties.length) return paragraph; // empty shape paragraph
      // only the first run carries a bullet (4.0.1 starts a paragraph at each run that has one): the runs after it
      // write the same properties without it, which the first replaces
      const plain = (p: string) => p.replace(/ (marL|indent)="-?\d+"/g, '').replace(/<a:bu\w+\b[^>]*\/>/g, '');
      if (!paragraph.startsWith(`<a:p>${properties[0]}`) || !properties.every(p => plain(p) === plain(properties[0]!))) unexpected('paragraph');
      let seen = false;
      return paragraph.replace(/<a:pPr\b[^>]*>.*?<\/a:pPr>/g, tag => { if (seen) return ''; seen = true; return tag; });
    });
    const title = titled.get(i - 1);
    if (title !== undefined) {
      const shape = new RegExp(`(<p:cNvPr id="\\d+" name="${xml(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">(?:<a:hlinkClick [^<>]*/>)?</p:cNvPr><p:cNvSpPr/>)<p:nvPr></p:nvPr>`);
      if ((slideXml.match(new RegExp(shape, 'g')) ?? []).length !== 1) unexpected('title');
      slideXml = slideXml.replace(shape, '$1<p:nvPr><p:ph type="title"/></p:nvPr>');
    }
    put(name, slideXml);
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
      if (table >= tables.length) unexpected('table');
      const tbl = tables[table][1];
      const tcs = tbl.match(/<a:tc(?:\s[^>]*)?>.*?<\/a:tc>/gs) ?? unexpected('table');
      let next = tbl;
      for (const patch of [...cells].reverse()) {
        if (patch.cell >= tcs.length) unexpected('table');
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

const xml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
