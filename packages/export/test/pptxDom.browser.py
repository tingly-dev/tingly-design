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
            try:
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
                check(r.ok,JSON.stringify(r));
                test(r.deck.slides[0].objects[0].type==='text'&&r.deck.slides[0].objects[1].type==='shape','direct text paints in flow, under the positioned cover that follows CSS order');
                root.innerHTML='<p><u><b>Nested underline bold</b></u></p>';
                r=await slidesDomToPptx([root],opts);
                test(r.ok&&r.deck.slides[0].objects.some(o=>o.type==='text'&&o.style.bold&&o.style.underline),'propagated nested underline carried by the run');
                root.innerHTML='<p style="width:85px">Wrap words across multiple lines</p><p style="display:none">hidden</p>';
                r=await slidesDomToPptx([root],opts);check(r.ok,JSON.stringify(r));
                const lines=r.deck.slides[0].objects.filter(o=>o.type==='text');
                test(new Set(lines.map(o=>o.y)).size>1,'Chrome auto-wrap becomes native line objects');
                test(!JSON.stringify(lines).includes('hidden'),'hidden elements omitted');
                for (const html of [
                    '<div style="width:100px;height:100px;background:linear-gradient(red,blue)">visible</div>',
                    '<svg width="20" height="20"><rect width="20" height="20"/></svg>',
                    '<x-embed style="display:block;width:100px;height:100px"></x-embed>',
                    '<div style="width:100px;height:20px;overflow:hidden"><p>clipped</p></div>',
                    '<div style="width:100px;height:40px;background:red;box-shadow:0 2px 8px black">shadow</div>'
                ]) {
                    root.innerHTML=html;r=await slidesDomToPptx([root],opts);
                    test(!r.ok && !r.deck && r.diagnostics.some(d=>d.severity==='error'&&d.path),'unsupported content fails atomically');
                }
                root.innerHTML='<p style="position:absolute;left:100px;top:200px;transform:rotate(10deg)">rotated</p>';
                r=await slidesDomToPptx([root],opts);check(r.ok,JSON.stringify(r));
                const spun=r.deck.slides[0].objects[0];
                test(spun.type==='text'&&Math.abs(spun.rotation-10)<0.01&&Math.abs(spun.y-200)<1.5&&spun.x>85&&spun.x<115&&spun.height>15&&spun.height<30,'a rotation-only transform stays native text with its laid-out box: '+JSON.stringify(spun));
                test((await PptxWriter.writePptx(r.deck)).length>1000,'writer accepts the spun object');
                root.innerHTML='<p style="transform:rotate(45deg)">degenerate</p>';
                r=await slidesDomToPptx([root],opts);test(!r.ok,'a 45° spin has no unambiguous laid-out box and fails');
                root.innerHTML='<div style="position:absolute;left:150px;top:150px;width:400px;height:120px;transform:rotate(10deg)"><p style="transform:rotate(20deg)">nested</p><p>plain</p></div>';
                r=await slidesDomToPptx([root],opts);check(r.ok,JSON.stringify(r));
                const nested=r.deck.slides[0].objects.filter(o=>o.type==='text');
                test(nested.length===2&&Math.round(nested.find(o=>o.paragraphs[0].runs[0].text==='nested')?.rotation)===30&&Math.abs((nested.find(o=>o.paragraphs[0].runs[0].text==='plain')?.rotation??99)-10)<0.01,'nested rotations compose');
                root.innerHTML='<p style="transform:skew(10deg)">skewed</p>';
                r=await slidesDomToPptx([root],opts);test(!r.ok,'skew is still drawn, not approximated');
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
                delete root.querySelector('p').dataset.dcPaintLayer;delete root.querySelector('div').dataset.dcPaintLayer;
                r=await slidesDomToPptx([root],opts);check(r.ok,JSON.stringify(r));
                test(r.deck.slides[0].objects[0].type==='shape'&&r.deck.slides[0].objects[1].type==='text','computed z-index orders siblings without runtime markers');
                root.innerHTML='<p style="opacity:.5;color:rgb(0,0,0)">alpha</p><div style="width:100px;height:30px;background:rgba(255,0,0,.25);border-radius:8px"></div><div style="width:100px;height:30px;border-bottom:2px solid rgb(0,0,255)"></div><p style="letter-spacing:4px;text-transform:uppercase;text-decoration:line-through">spaced</p>';
                r=await slidesDomToPptx([root],opts);check(r.ok,JSON.stringify(r));
                let objs=r.deck.slides[0].objects;
                test(objs.some(o=>o.type==='text'&&o.style.opacity===0.5),'element opacity becomes native text transparency');
                test(objs.some(o=>o.type==='shape'&&o.shape==='roundRect'&&o.radiusPx===8&&o.fill==='FF0000'&&o.fillOpacity===0.25),'translucent rounded box stays a native rounded rectangle');
                test(objs.some(o=>o.type==='shape'&&o.shape==='line'&&o.height===0&&o.stroke.color==='0000FF'&&o.stroke.widthPx===2),'one-sided border becomes a native line');
                test(objs.some(o=>o.type==='text'&&o.paragraphs[0].runs[0].text==='SPACED'&&o.style.charSpacingPx===4&&o.style.strike&&o.wrap===false),'letter spacing, text-transform and line-through stay native');
                test((await PptxWriter.writePptx(r.deck)).length>1000,'writer accepts opacity, radius, spacing and strike');
                root.innerHTML='<ol style="padding-left:40px"><li>First</li><li>Second</li></ol><ul style="padding-left:40px"><li>Dot</li></ul>';
                r=await slidesDomToPptx([root],opts);check(r.ok,JSON.stringify(r));
                objs=r.deck.slides[0].objects.filter(o=>o.type==='text');
                const label=t=>objs.find(o=>o.paragraphs[0].runs[0].text===t);
                test(label('1.')&&label('2.')&&label('•'),'list markers become native text: '+JSON.stringify(objs.map(o=>o.paragraphs[0].runs[0].text)));
                test(label('1.').x+label('1.').width<=label('First').x+0.5&&Math.abs(label('1.').y-label('First').y)<1,'marker sits left of its first line');
                const rcalls=[];
                const raster={asset,x:5,y:6,width:7,height:8};
                const drawing={...opts,rasterizeElement:async (el,ctx)=>{rcalls.push([el.tagName.toLowerCase(),ctx.mode,ctx.feature]);return raster}};
                root.innerHTML='<div style="width:300px;height:100px;background:linear-gradient(red,blue);padding:10px"><p>On gradient</p></div><svg width="20" height="20"><rect width="20" height="20"/></svg>';
                r=await slidesDomToPptx([root],drawing);check(r.ok,JSON.stringify(r));
                objs=r.deck.slides[0].objects;
                test(rcalls.length===2&&rcalls[0][0]==='div'&&rcalls[0][1]==='self'&&rcalls[0][2]==='gradient'&&rcalls[1][0]==='svg'&&rcalls[1][1]==='subtree'&&rcalls[1][2]==='svg','gradient drawn as its own box only, SVG with its contents: '+JSON.stringify(rcalls));
                test(objs[0].type==='image'&&objs[1].type==='text'&&objs[1].paragraphs[0].runs[0].text==='On gradient'&&objs[2].type==='image','text over a drawn box stays native, in paint order');
                test(r.diagnostics.filter(d=>d.code==='rasterized'&&d.severity==='warning').length===1,'the drawn gradient is reported; the SVG is native, not a picture');
                const drawing0=objs[2];
                test(drawing0.asset&&r.deck.assets[drawing0.asset].mime==='image/svg+xml'&&r.deck.assets[drawing0.asset].fallback instanceof Uint8Array,'an SVG element carries the SVG and its rendered stand-in');
                test(drawing0.x===5&&drawing0.y===6&&drawing0.width===7&&drawing0.height===8,'the SVG takes the picture of it as drawn: '+JSON.stringify([drawing0.x,drawing0.y,drawing0.width,drawing0.height]));
                rcalls.length=0;
                root.innerHTML='<div style="position:absolute;left:200px;top:200px;width:300px;transform:rotate(5deg)"><p>Turned</p></div><p>Kept</p>';
                r=await slidesDomToPptx([root],drawing);check(r.ok,JSON.stringify(r));
                test(rcalls.length===0,'a rotation-only div is native now, nothing rasterized: '+JSON.stringify(rcalls));
                const turned=r.deck.slides[0].objects.filter(o=>o.type==='text');
                test(turned.length===2&&Math.abs((turned.find(o=>o.paragraphs[0].runs[0].text==='Turned')?.rotation??99)-5)<0.01,'its text keeps the subtree rotation');
                root.innerHTML='<div style="width:100px;height:40px;background:linear-gradient(red,blue)"><p>grad</p></div>';
                r=await slidesDomToPptx([root],{...opts,rasterizeElement:async()=>{throw new Error('nope')}});
                test(!r.ok&&r.diagnostics.some(d=>d.feature==='rasterization'),'a failing rasterizer fails the slide, never silently drops the element');
                r=await slidesDomToPptx([root],{...opts,rasterizeElement:async()=>null});check(r.ok,JSON.stringify(r));
                test(r.deck.slides[0].objects.length===1,'an element that painted nothing adds nothing');
                root.innerHTML='<p>must not duplicate</p><svg width="20" height="20"></svg><aside>Fallback notes</aside>';
                r=await slidesDomToPptx([root],{...opts,rasterizeSlide:async (el,ctx)=>{test(el===root&&ctx.diagnostics.length>0,'explicit capture context');return asset}});
                check(r.ok,JSON.stringify(r));
                test(r.deck.slides[0].objects.length===1&&r.deck.slides[0].objects[0].type==='image','whole-slide raster replaces all native objects');
                test(r.diagnostics.some(d=>d.code==='rasterized'),'fallback diagnosed');
                test(r.deck.slides[0].notes==='Fallback notes','fallback retains notes');
                root.innerHTML='<table style="border-collapse:collapse;width:400px"><tr><th colspan="2" style="background:rgb(68,114,196);color:rgb(255,255,255);border-bottom:2px solid rgb(255,255,255);padding:4px 8px;text-align:center">Head 中文</th></tr><tr><td rowspan="2" style="padding:4px 8px;vertical-align:middle">Tall</td><td style="padding:4px 8px"><b>Bold</b> and plain<br>second line</td></tr><tr><td style="padding:4px 8px;background:rgba(0,0,0,.5)"></td></tr></table>';
                r=await slidesDomToPptx([root],opts);check(r.ok,JSON.stringify(r));
                const tbl=r.deck.slides[0].objects.find(o=>o.type==='table');
                test(tbl&&tbl.columnsPx.length===2&&tbl.rowsPx.length===3&&r.deck.slides[0].objects.filter(o=>o.type==='text').length===0,'a CSS table becomes one native table: '+JSON.stringify(r.deck.slides[0].objects.map(o=>o.type)));
                test(tbl.rows[0][0].colspan===2&&tbl.rows[1][0].rowspan===2&&tbl.rows[0][0].fill==='4472C4'&&tbl.rows[0][0].paragraphs[0].align==='center'&&tbl.rows[0][0].borders[2].color==='FFFFFF','merges, fill, alignment and borders carried: '+JSON.stringify(tbl.rows[0][0]));
                test(tbl.rows[1][1].paragraphs.length===2&&tbl.rows[1][1].paragraphs[0].runs[0].style.bold&&tbl.rows[1][0].verticalAlign==='middle'&&tbl.rows[2][0].fillOpacity===0.5,'runs, line breaks, vertical alignment and translucent fills: '+JSON.stringify(tbl.rows[1]));
                test((await PptxWriter.writePptx(r.deck)).length>1000,'writer accepts the measured table');
                root.innerHTML='<table style="position:absolute;left:10px;top:10px;width:200px;height:60px"><tr style="position:absolute;left:0;top:0;width:200px;height:30px"><td style="position:absolute;left:0;top:0;width:100px;height:30px;padding:0"><div style="position:absolute;left:0;top:0;width:100%;height:100%;display:flex;flex-direction:column;justify-content:flex-end;padding:2px 4px"><p>A</p></div></td><td style="position:absolute;left:100px;top:0;width:100px;height:30px;padding:0">B</td></tr><tr style="position:absolute;left:0;top:30px;width:200px;height:30px"><td style="position:absolute;left:0;top:0;width:200px;height:30px;padding:0" colspan="2">C</td></tr></table>';
                r=await slidesDomToPptx([root],opts);check(r.ok,JSON.stringify(r));
                const placed=r.deck.slides[0].objects.find(o=>o.type==='table');
                test(placed&&placed.x===10&&placed.rows[0][0].verticalAlign==='bottom'&&placed.rows[0][0].paddingPx[3]===4&&placed.rows[1][0].colspan===2,'an absolutely placed table keeps its grid, insets and alignment: '+JSON.stringify(placed));
                root.innerHTML='<table style="border-collapse:separate;border-spacing:6px"><tr><td>gap</td><td>gap</td></tr></table><table><tr><td><svg width="10" height="10"></svg></td></tr></table>';
                r=await slidesDomToPptx([root],opts);
                test(!r.deck||!r.deck.slides[0].objects.some(o=>o.type==='table'),'spaced cells and cells with drawings stay per element');
                root.innerHTML='<table style="border-collapse:collapse"><tr>'
                  +'<td style="width:120px;height:60px;padding:0;border:3px double rgb(17,17,17);position:relative"><p>box</p></td>'
                  +'<td style="width:120px;height:60px;padding:0;position:relative"><p>diag</p><svg viewBox="0 0 1 1" preserveAspectRatio="none" style="position:absolute;left:0px;top:0px;width:100%;height:100%;overflow:visible"><path d="M0 0L1 1" fill="none" stroke="rgb(204,0,0)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg></td></tr>'
                  +'<tr><td colspan="2" style="width:240px;height:60px;padding:0;position:relative"><div style="position:absolute;left:90px;top:-90px;width:240px;height:60px;display:flex;flex-direction:column;justify-content:center;transform:rotate(270deg)"><p>vertical</p></div></td></tr></table>';
                r=await slidesDomToPptx([root],opts);check(r.ok,JSON.stringify(r));
                const exotic=r.deck.slides[0].objects.find(o=>o.type==='table');check(exotic,JSON.stringify(r.deck.slides[0].objects.map(o=>o.type)));
                test(exotic.rows[0][0].borders.every(b=>b&&b.double),'a CSS double border stays a native double border');
                test(exotic.rows[0][1].tl2br&&exotic.rows[0][1].tl2br.color==='CC0000'&&exotic.rows[0][1].tl2br.widthPx===2&&!exotic.rows[0][1].tr2bl,"the importer's diagonal SVG comes back as the cell's diagonal border: "+JSON.stringify(exotic.rows[0][1]));
                test(exotic.rows[1][0].textDirection==='vert270'&&exotic.rows[1][0].paragraphs[0].runs[0].text==='vertical'&&exotic.rows[1][0].verticalAlign==='middle',"the importer's spun text box comes back as a vertical cell: "+JSON.stringify(exotic.rows[1][0]));
                test((await PptxWriter.writePptx(r.deck)).length>1000,'writer accepts double borders, diagonals and vertical cells');
                root.innerHTML='<table style="border-collapse:collapse"><tr><td><p>one</p><p>two</p></td><td>x<br><br>y</td></tr></table>';
                r=await slidesDomToPptx([root],opts);check(r.ok,JSON.stringify(r));
                const tb2=r.deck.slides[0].objects.find(o=>o.type==='table');check(tb2,JSON.stringify(r.deck.slides[0].objects.map(o=>o.type)));const paras=tb2.rows[0].map(c=>c.paragraphs.map(p=>p.runs.map(x=>x.text).join('')));
                test(JSON.stringify(paras)==='[["one","two"],["x","","y"]]','block cells start at their first block, and line breaks keep empty lines: '+JSON.stringify(paras));
                root.innerHTML='<table style="border-collapse:collapse"><tr><td style="opacity:.5">faded</td></tr></table><table style="border-collapse:collapse"><tr><td><span style="opacity:.5">faded</span></td></tr></table>';
                r=await slidesDomToPptx([root],opts);
                test(!r.deck||!r.deck.slides[0].objects.some(o=>o.type==='table'),'translucent cells and cell content stay per element');
                root.innerHTML='<div style="display:flex"><p style="order:1">second</p><p>first</p></div><x-shape kind="rect" style="width:30px;height:30px;background:red;border-radius:12px"></x-shape><p style="position:absolute;top:440px;font-size:30px">bleeding glyphs</p><p style="position:absolute;left:900px">gone</p>';
                r=await slidesDomToPptx([root],opts);check(r.ok,JSON.stringify(r));
                objs=r.deck.slides[0].objects;
                const words=objs.filter(o=>o.type==='text').map(o=>o.paragraphs[0].runs[0].text);
                test(words.indexOf('first')<words.indexOf('second'),'flex order is paint order');
                test(objs.some(o=>o.type==='shape'&&o.shape==='roundRect'&&o.radiusPx===12),'rounded rect x-shape keeps its radius');
                test(words.includes('bleeding glyphs')&&!words.includes('gone'),'partly outside kept, wholly outside left out');
                root.innerHTML='<div><span style="position:absolute;left:0;top:0;width:50px;height:50px;background:rgb(0,0,255);display:block"></span></div><div style="width:100px;height:100px;background:rgb(255,0,0)"></div><p style="text-decoration:underline">Link<span style="position:absolute;left:300px;top:300px">badge</span></p>';
                r=await slidesDomToPptx([root],opts);check(r.ok,JSON.stringify(r));
                objs=r.deck.slides[0].objects;
                test(objs.findIndex(o=>o.fill==='0000FF')>objs.findIndex(o=>o.fill==='FF0000'),'a positioned box inside a static parent paints above later in-flow siblings');
                test(!objs.find(o=>o.type==='text'&&o.paragraphs[0].runs[0].text==='badge').style.underline&&objs.find(o=>o.type==='text'&&o.paragraphs[0].runs[0].text==='Link').style.underline,'decorations do not reach out-of-flow descendants');
                root.innerHTML='<div style="width:4000px;height:50px;background:rgb(0,128,0)"></div>';
                r=await slidesDomToPptx([root],opts);check(r.ok,JSON.stringify(r));
                test(r.deck.slides[0].objects[0].width===800,'a box far past the page is cut to it');
                test((await PptxWriter.writePptx(r.deck)).length>1000,'and the writer accepts it');
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
            except Exception as error:
                raise SystemExit(f'FAIL browser contract: {error}')
            print(f"PASS real Chrome PPTX DOM contracts: {result['assertions']} assertions")
            await browser.close()

asyncio.run(main())
