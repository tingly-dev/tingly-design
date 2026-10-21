import { describe, expect, it } from 'vitest';
import PptxGenJS from 'pptxgenjs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { normalizePptx401 } from '../src/pptxNormalize';

async function generated() {
  const p = new PptxGenJS(); p.title = 'Metadata 中文 <&>';
  const s = p.addSlide(); s.addNotes('Notes 中文 <&>\nsecond line');
  s.addText([{ text: 'one', options: { align: 'center', bold: true } }, { text: 'two', options: { align: 'center', italic: true } }], { x: 1, y: 1, w: 5, h: 2 });
  p.addSlide().addText('page two', { x: 1, y: 1, w: 5, h: 2 });
  return new Uint8Array(await p.write({ outputType: 'arraybuffer' }) as ArrayBuffer);
}

describe('pinned writer package normalization boundaries', () => {
  it('changes only known structural XML, leaving metadata, notes, relationships and all other parts byte-identical', async () => {
    const bytes = await generated();
    const before = unzipSync(bytes), after = unzipSync(normalizePptx401(bytes, 2));
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const name of Object.keys(before)) {
      if (!['ppt/presentation.xml', '[Content_Types].xml', 'ppt/slides/slide1.xml'].includes(name)) expect(after[name], name).toEqual(before[name]);
    }
    const originalSlide = strFromU8(before['ppt/slides/slide1.xml']);
    const normalizedSlide = strFromU8(after['ppt/slides/slide1.xml']);
    const properties = originalSlide.match(/<a:pPr\b[^>]*>.*?<\/a:pPr>/g)!;
    expect(properties).toHaveLength(2);
    const at = originalSlide.lastIndexOf(properties[1]);
    expect(normalizedSlide).toBe(originalSlide.slice(0, at) + originalSlide.slice(at + properties[1].length));
    // Input bytes/parts are not rewritten in place.
    expect(unzipSync(bytes)).toEqual(before);
  });

  it.each(['conflicting properties', 'missing slide', 'missing media override', 'existing extra master', 'changed master override', 'unexpected presentation order'])('rejects %s rather than guessing at arbitrary package repair', async change => {
    const parts = unzipSync(await generated());
    if (change === 'conflicting properties') {
      const name = 'ppt/slides/slide1.xml';
      const s = strFromU8(parts[name]); const at = s.lastIndexOf('<a:pPr algn="ctr"');
      expect(at).toBeGreaterThan(0);
      parts[name] = strToU8(s.slice(0, at) + s.slice(at).replace('algn="ctr"', 'algn="r"'));
    } else if (change === 'missing slide') delete parts['ppt/slides/slide2.xml'];
    else if (change === 'missing media override') parts['[Content_Types].xml'] = strToU8(strFromU8(parts['[Content_Types].xml']).replace('</Types>', '<Override PartName="/ppt/media/missing.png" ContentType="image/png"/></Types>'));
    else if (change === 'existing extra master') parts['ppt/slideMasters/slideMaster2.xml'] = parts['ppt/slideMasters/slideMaster1.xml'];
    else if (change === 'changed master override') parts['[Content_Types].xml'] = strToU8(strFromU8(parts['[Content_Types].xml']).replace('PartName="/ppt/slideMasters/slideMaster2.xml"', 'PartName="/ppt/slideMasters/other.xml"'));
    else parts['ppt/presentation.xml'] = strToU8(strFromU8(parts['ppt/presentation.xml']).replace(/(<p:sldIdLst>.*?<\/p:sldIdLst>)(<p:notesMasterIdLst>.*?<\/p:notesMasterIdLst>)/, '$2$1'));
    expect(() => normalizePptx401(zipSync(parts), 2)).toThrow(/unexpected PptxGenJS/);
  });
});
