"""Focused actual-runtime PPTX resource/capture regressions (local Chrome, no product server).
python3 packages/export/test/pptxProduct.browser.py
"""
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[3]
CHROME = os.environ.get('DC_CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

async def main():
    subprocess.run(['pnpm', '--filter', '@dc/sandbox', 'build'], cwd=ROOT, check=True)
    with tempfile.TemporaryDirectory(prefix='pptx-product-') as folder:
        bundle = Path(folder) / 'product.js'
        subprocess.run([str(ROOT / 'node_modules/.bin/esbuild'), str(ROOT / 'apps/editor/src/components/slides/pptxExport.ts'), '--bundle', '--platform=browser', '--format=iife', '--global-name=PptxProduct', f'--outfile={bundle}'], cwd=ROOT, check=True)
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == '/': body, mime = b'<!doctype html><body></body>', 'text/html'
                elif self.path == '/product.js': body, mime = bundle.read_bytes(), 'text/javascript'
                elif self.path == '/sandbox/runtime.js': body, mime = (ROOT / 'packages/sandbox/dist/runtime.js').read_bytes() + b";addEventListener('message',e=>{if(e.data?.dcPptx==='capture')parent.postMessage({testAssets:Object.keys(e.data.images).length},'*')});", 'text/javascript'
                else: self.send_error(404); return
                self.send_response(200); self.send_header('Content-Type', mime); self.send_header('Access-Control-Allow-Origin', '*'); self.end_headers(); self.wfile.write(body)
            def log_message(self, *args): pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        origin = f'http://127.0.0.1:{server.server_address[1]}'
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(executable_path=CHROME, headless=True)
                page = await browser.new_page()
                await page.goto(origin)
                await page.add_script_tag(url=origin + '/product.js')
                result = await page.evaluate('''async origin => {
                    const check=(c,m)=>{if(!c)throw Error(m)};
                    let assertions=0;const test=(c,m)=>{check(c,m);assertions++};
                    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;
                    const ctx=canvas.getContext('2d');const pixels=ctx.createImageData(1024,1024);
                    let seed=123456789;for(let i=0;i<pixels.data.length;i+=4){seed=(1664525*seed+1013904223)>>>0;pixels.data[i]=seed>>>24;pixels.data[i+1]=seed>>>16;pixels.data[i+2]=seed>>>8;pixels.data[i+3]=255}ctx.putImageData(pixels,0,0);
                    const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const large=new Uint8Array(await blob.arrayBuffer());
                    test(large.length>1024*1024,'fixture actually exceeds 1MiB compressed');
                    const small=document.createElement('canvas');small.width=1;small.height=1;small.getContext('2d').fillRect(0,0,1,1);
                    const tiny=new Uint8Array(await (await new Promise(r=>small.toBlob(r,'image/png'))).arrayBuffer());
                    const forged=tiny.slice();new DataView(forged.buffer).setUint32(16,100000);new DataView(forged.buffer).setUint32(20,100000);
                    const realFetch=window.fetch;let fetches=[];let decodeCalls=0;const decode=window.createImageBitmap;
                    window.createImageBitmap=(...args)=>{decodeCalls++;return decode(...args)};
                    window.fetch=async(url,opts)=>{fetches.push(String(url));if(String(url).endsWith('/large.png'))return new Response(large,{headers:{'content-type':'image/png'}});if(String(url).endsWith('/forged.png'))return new Response(forged,{headers:{'content-type':'image/png'}});if(String(url).endsWith('/tiny.png'))return new Response(tiny,{headers:{'content-type':'image/png'}});return realFetch(url,opts)};
                    const snapshot=slides=>({title:'Resource tests',faces:{},base:origin+'/raw/',runtimeOrigin:origin,slides});
                    const slide=(id,img)=>({id,source:`<section id="${id}" style="background:white;color:black;font-family:Arial"><img src="${img}" style="width:100px;height:100px"></section>`});
                    let failed;
                    try{await PptxProduct.deckSnapshotToPptx(snapshot([slide('forged','forged.png')]))}catch(e){failed=e}
                    test(failed instanceof PptxProduct.DeckPptxError&&failed.slide==='forged'&&failed.diagnostics[0].feature==='image-pixels','forged header has page-specific pixel rejection');
                    test(decodeCalls===0,'forged oversized header rejected BEFORE decoding');
                    test(!document.querySelector('iframe[data-pptx-capture]'),'predecode failure leaves no frame');
                    const messages=[];addEventListener('message',e=>{if(typeof e.data?.testAssets==='number')messages.push(e.data.testAssets)});
                    const result=await PptxProduct.deckSnapshotToPptx(snapshot([slide('large','large.png'),slide('tiny','tiny.png')]));
                    test(result.bytes[0]===80&&result.bytes[1]===75&&result.bytes.length>1000,'actual runtime accepts >1MiB inline source and writes real PPTX');
                    test(messages.length===2&&messages.every(n=>n===1),'each capture carries only this page assets');
                    test(!document.querySelector('iframe[data-pptx-capture]'),'successful multi-page capture cleans up iframe');
                    const hidden={id:'hidden',source:'<section style="background:white;font-family:Arial"><p>Visible</p><div data-hide><img src="https://invalid.example/no.png"></div></section>'};
                    const before=fetches.length;await PptxProduct.deckSnapshotToPptx(snapshot([hidden]));
                    test(!fetches.slice(before).some(url=>url.includes('invalid.example')),'hidden remote picture never prefetched');
                    const fontSnapshot=snapshot([{id:'font',source:'<section style="font-family:Broken"><p>Must not silently fall back</p></section>'}]);fontSnapshot.faces={broken:{family:'Broken',src:'tiny.png'}};
                    failed=undefined;try{await PptxProduct.deckSnapshotToPptx(fontSnapshot)}catch(e){failed=e}
                    test(failed instanceof PptxProduct.DeckPptxError&&failed.slide==='font'&&failed.diagnostics.some(d=>d.feature==='font'),'invalid frozen font fails honestly rather than silently falling back');
                    test(!document.querySelector('iframe[data-pptx-capture]'),'font failure cleans up frame');
                    const aborted=new AbortController();aborted.abort();failed=undefined;
                    try{await PptxProduct.deckSnapshotToPptx(snapshot([slide('abort','tiny.png')]),{signal:aborted.signal})}catch(e){failed=e}
                    test(failed?.name==='AbortError'&&!document.querySelector('iframe[data-pptx-capture]'),'pre-aborted export leaves no runtime or download');
                    return {assertions};
                }''', origin)
                print(f"PASS actual sandbox PPTX resource contracts: {result['assertions']} assertions")
                await browser.close()
        finally: server.shutdown(); server.server_close()

asyncio.run(main())
