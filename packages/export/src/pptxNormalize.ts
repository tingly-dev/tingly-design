import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/** Only for this writer's freshly generated PptxGenJS 4.0.1 package, never imported OOXML.
 * Byte-for-byte XML edits retain all run/notes/media content. Fail closed if the pinned
 * generator's known vocabulary changes; this is not a general OOXML repair facility.
 */
export function normalizePptx401(bytes: Uint8Array, slideCount: number): Uint8Array {
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
  return zipSync(parts, { level: 6 });
}
