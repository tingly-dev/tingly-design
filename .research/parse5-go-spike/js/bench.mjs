import { parseFragment } from 'parse5'; import fs from 'node:fs';
for (const f of process.argv.slice(2)) { const L = fs.readFileSync(f,'utf8').trim().split('\n').map(JSON.parse);
  for (const s of L.slice(0,20)) parseFragment(s,{sourceCodeLocationInfo:true});
  const t=performance.now(); for (const s of L) parseFragment(s,{sourceCodeLocationInfo:true}); const dt=performance.now()-t;
  console.log(f, 'parse5 ms/doc', (dt/L.length).toFixed(3)); }
