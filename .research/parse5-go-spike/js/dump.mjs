import { parseFragment } from 'parse5';
import { createInterface } from 'node:readline';
const NS = { 'http://www.w3.org/1999/xhtml': 'html', 'http://www.w3.org/2000/svg': 'svg', 'http://www.w3.org/1998/Math/MathML': 'math' };
export function dump(src) {
  // UTF-16 offset -> UTF-8 byte offset
  const map = new Int32Array(src.length + 1); let b = 0;
  for (let i = 0; i < src.length; i++) { map[i] = b; const c = src.charCodeAt(i);
    if (c < 0x80) b += 1; else if (c < 0x800) b += 2; else if (c >= 0xd800 && c < 0xdc00) { map[i+1] = b; b += 4; i++; } else b += 3; }
  map[src.length] = b;
  const sp = (l) => l ? `${map[l.startOffset]}-${map[l.endOffset]}` : '-';
  let out = '';
  const walk = (n, d) => { for (const c of n.childNodes || []) {
    const ind = ' '.repeat(d); const l = c.sourceCodeLocation; const loc = l ? sp(l) : 'NOLOC';
    if (c.nodeName === '#text') out += `${ind}#text ${loc}\n`;
    else if (c.nodeName === '#comment') out += `${ind}#comment ${loc}\n`;
    else if (c.tagName) {
      let st = '-', et = '-', at = '';
      if (l) { st = sp(l.startTag); et = sp(l.endTag);
        for (const a of c.attrs) { const k = a.prefix ? `${a.prefix}:${a.name}` : a.name;
          const al = l.attrs?.[k] ?? l.attrs?.[a.name] ?? l.attrs?.[k.toLowerCase()]; at += ` ${k}@${sp(al)}`; } }
      out += `${ind}${c.tagName}[${NS[c.namespaceURI]}] ${loc} st=${st} et=${et}${at}\n`;
      walk(c.tagName === 'template' && c.content ? c.content : c, d + 1);
    } } };
  walk(parseFragment(src, { sourceCodeLocationInfo: true }), 0);
  return out;
}
if (process.argv[2] === 'run') {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) process.stdout.write(JSON.stringify(dump(JSON.parse(line))) + '\n');
}
