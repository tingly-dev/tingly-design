"""Standalone real-layout adapter contracts (no app/server).
Run: python3 packages/export/test/pptxDom.browser.py
Requires repository esbuild, Python playwright and Chrome (DC_CHROME overrides).
"""
import asyncio
import os
from pathlib import Path
import subprocess
import tempfile
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[3]
CHROME = os.environ.get('DC_CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

async def main():
    with tempfile.TemporaryDirectory(prefix='pptx-dom-') as folder:
        bundle = Path(folder) / 'adapter.js'
        subprocess.run([str(ROOT / 'node_modules/.bin/esbuild'), str(ROOT / 'packages/export/src/pptxDom.ts'), '--bundle', '--format=iife', '--global-name=PptxDom', f'--outfile={bundle}'], check=True, cwd=ROOT)
        writer = Path(folder) / 'writer.js'
        subprocess.run([str(ROOT / 'node_modules/.bin/esbuild'), str(ROOT / 'packages/export/src/pptx.ts'), '--bundle', '--platform=browser', '--format=iife', '--global-name=PptxWriter', f'--outfile={writer}'], check=True, cwd=ROOT)
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, headless=True)
            page = await browser.new_page()
            await page.set_content('''<style>*{box-sizing:border-box}body{margin:0} section{position:relative;width:800px;height:450px;background:white;font-family:Arial;font-size:20px}p{margin:0}x-shape{display:block}</style><section id="slide"></section>''')
            await page.add_script_tag(path=str(bundle))
            await page.add_script_tag(path=str(writer))
            result = await page.evaluate('''async () => {
                const {slidesDomToPptx}=PptxDom;
                const root=document.querySelector('section');
                const opts={title:'Native 中文',widthIn:10};
                const check=(condition,message)=>{if(!condition)throw Error(message)};
                let count=0;
                const test=(c,m)=>{check(c,m);count++};
                root.innerHTML='<div style="display:flex;gap:30px;padding:20px"><p style="width:160px;color:rgb(12,34,56)">Hello <b>中文 bold</b><br>Second line</p><x-shape kind="rect" style="width:70px;height:40px;background:rgb(255,0,0)"></x-shape></div><aside>Speaker 中文 & notes</aside>';
                let r=await slidesDomToPptx([root],opts);
                check(r.ok,JSON.stringify(r));
                test(r.deck.widthPx===800 && r.deck.heightPx===450,'actual root size');
                const rect=r.deck.slides[0].objects.find(o=>o.type==='shape'&&o.fill==='FF0000');
                test(rect.x===210&&rect.y===20&&rect.width===70,'flex geometry measured, not parsed');
                const text=r.deck.slides[0].objects.filter(o=>o.type==='text');
                test(text.some(o=>o.style.bold&&o.paragraphs[0].runs[0].text.includes('中文')),'native CJK bold run');
                test(text.some(o=>o.y>text[0].y&&o.paragraphs[0].runs[0].text.includes('Second')),'actual line break');
                test(r.deck.slides[0].notes==='Speaker 中文 & notes','notes excluded from drawing');
                test(!text.some(o=>o.paragraphs[0].runs[0].text.includes('Speaker')),'no notes painted');
                const packageBytes=await PptxWriter.writePptx(r.deck);
                test(packageBytes instanceof Uint8Array&&packageBytes.length>1000&&packageBytes[0]===0x50&&packageBytes[1]===0x4b,'real browser DOM drawing data writes PPTX package');
                root.innerHTML='<div style="position:absolute;left:0;top:0;width:300px;height:80px;background:red"></div>Covered text';
                r=await slidesDomToPptx([root],opts);
                test(!r.ok&&r.diagnostics.some(d=>d.feature==='mixed-position-paint-order'),'direct rendered text mixed with positioned cover rejects unsafe paint order');
                root.innerHTML='<p><u><b>Nested underline bold</b></u></p>';
                r=await slidesDomToPptx([root],opts);
                test((r.ok&&r.deck.slides[0].objects.some(o=>o.type==='text'&&o.style.bold&&o.style.underline))||(!r.ok&&r.diagnostics.some(d=>d.feature==='propagated-text-decoration')),'propagated nested underline retained or explicitly rejected');
                root.innerHTML='<p style="width:85px">Wrap words across multiple lines</p><p style="display:none">hidden</p>';
                r=await slidesDomToPptx([root],opts);check(r.ok,JSON.stringify(r));
                const lines=r.deck.slides[0].objects.filter(o=>o.type==='text');
                test(new Set(lines.map(o=>o.y)).size>1,'Chrome auto-wrap becomes native line objects');
                test(!JSON.stringify(lines).includes('hidden'),'hidden elements omitted');
                for (const html of [
                    '<div style="width:100px;height:100px;background:linear-gradient(red,blue)">visible</div>',
                    '<svg width="20" height="20"><rect width="20" height="20"/></svg>',
                    '<x-embed style="display:block;width:100px;height:100px"></x-embed>',
                    '<p style="opacity:.5">alpha</p>',
                    '<p style="transform:rotate(10deg)">rotated</p>',
                    '<ul><li>list marker</li></ul>',
                    '<div style="width:100px;height:20px;overflow:hidden"><p>clipped</p></div>',
                    '<p style="z-index:2;position:relative">stack</p>'
                ]) {
                    root.innerHTML=html;r=await slidesDomToPptx([root],opts);
                    test(!r.ok && !r.deck && r.diagnostics.some(d=>d.severity==='error'&&d.path),'unsupported content fails atomically');
                }
                root.innerHTML='<img style="width:40px;height:20px;object-fit:contain" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==">';
                const image=root.querySelector('img');await image.decode();
                r=await slidesDomToPptx([root],opts);test(!r.ok,'no implicit image fetch or data URL decoding');
                let calls=0;
                const asset={bytes:Uint8Array.from(atob(image.src.split(',')[1]),c=>c.charCodeAt(0)),mime:'image/png',widthPx:1,heightPx:1};
                r=await slidesDomToPptx([root],{...opts,resolveImage:async supplied=>{test(supplied===image,'resolver receives actual supplied DOM image');calls++;return asset}});
                check(r.ok,JSON.stringify(r));test(calls===1&&r.deck.slides[0].objects[0].type==='image','native byte image');
                root.innerHTML='<p style="position:relative;z-index:2" data-dc-paint-layer="2">front</p><div style="position:absolute;z-index:1;left:0;top:0;width:100px;height:50px;background:red" data-dc-paint-layer="1"></div>';
                r=await slidesDomToPptx([root],{...opts,paintOrder:'tingly-slide-v1'});check(r.ok,JSON.stringify(r));
                test(r.deck.slides[0].objects[0].type==='shape'&&r.deck.slides[0].objects[1].type==='text','known runtime layers sorted rather than discarded');
                root.querySelector('p').dataset.dcPaintLayer='1';
                r=await slidesDomToPptx([root],{...opts,paintOrder:'tingly-slide-v1'});
                test(!r.ok,'mismatched runtime layer rejected');
                root.querySelector('p').dataset.dcPaintLayer='2';
                r=await slidesDomToPptx([root],opts);test(!r.ok,'runtime markers do not enable stacking without opt in');
                root.innerHTML='<p>must not duplicate</p><svg width="20" height="20"></svg><aside>Fallback notes</aside>';
                r=await slidesDomToPptx([root],{...opts,rasterizeSlide:async (el,ctx)=>{test(el===root&&ctx.diagnostics.length>0,'explicit capture context');return asset}});
                check(r.ok,JSON.stringify(r));
                test(r.deck.slides[0].objects.length===1&&r.deck.slides[0].objects[0].type==='image','whole-slide raster replaces all native objects');
                test(r.diagnostics.some(d=>d.code==='rasterized'),'fallback diagnosed');
                test(r.deck.slides[0].notes==='Fallback notes','fallback retains notes');
                for (const html of [
                    '<p style="position:absolute;top:440px;font-size:30px">overflowing glyphs</p>',
                    '<div style="display:flex"><p style="order:1">reordered</p></div>',
                    '<x-shape kind="rect" style="width:30px;height:30px;background:red;border-radius:12px"></x-shape>'
                ]) {root.innerHTML=html;r=await slidesDomToPptx([root],opts);test(!r.ok,'unsupported layout cannot silently lose paint');}
                root.innerHTML='<img style="width:40px;height:20px" src="'+image.src+'">';await root.querySelector('img').decode();
                r=await slidesDomToPptx([root],{...opts,limits:{timeoutMs:20},resolveImage:()=>new Promise(()=>{})});
                test(!r.ok&&r.diagnostics.some(d=>d.code==='budget'),'hanging resolver bounded by timeout');
                root.innerHTML='<p>  Alpha   beta\\n gamma </p>';r=await slidesDomToPptx([root],opts);check(r.ok,JSON.stringify(r));
                test(r.deck.slides[0].objects.filter(o=>o.type==='text').map(o=>o.paragraphs[0].runs[0].text).join('')==='Alpha beta gamma','collapsed source whitespace measured: '+JSON.stringify(r.deck.slides[0].objects));
                root.innerHTML='<x-shape kind="arrow-right" style="display:block;width:80px;height:40px"><svg width="100%" height="100%" viewBox="0 0 100 100"><path d="M0 30H60V0L100 50L60 100V70H0Z" fill="red"/></svg></x-shape>';
                r=await slidesDomToPptx([root],opts);test(!r.ok,'actual SVG-rendered core arrow explicitly unsupported');
                document.body.style.opacity='.5';r=await slidesDomToPptx([root],opts);test(!r.ok,'ancestor opacity rejected');document.body.style.opacity='';
                root.innerHTML='<p>Hello</p>';
                r=await slidesDomToPptx([root],{...opts,limits:{maxTextCharacters:2}});test(!r.ok&&r.diagnostics.some(d=>d.code==='budget'),'text budget');
                r=await slidesDomToPptx([root],{...opts,limits:{maxObjects:1}});test(r.ok,'object budget boundary');
                const abort=new AbortController();abort.abort();r=await slidesDomToPptx([root],{...opts,signal:abort.signal});test(!r.ok,'pre-aborted capture');
                root.style.transform='scale(.5)';r=await slidesDomToPptx([root],opts);test(!r.ok,'viewport-scaled roots explicitly rejected');root.style.transform='';
                const second=root.cloneNode(true);second.style.width='700px';document.body.append(second);
                r=await slidesDomToPptx([root,second],opts);test(!r.ok,'different page sizes fail');second.remove();
                root.remove();r=await slidesDomToPptx([root],opts);test(!r.ok,'disconnected root fails');
                return {assertions:count};
            }''')
            print(f"PASS real Chrome PPTX DOM contracts: {result['assertions']} assertions")
            await browser.close()

asyncio.run(main())
