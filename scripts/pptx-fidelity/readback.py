"""How editable an exported .pptx is, read back with python-pptx (an independent reader), slide by slide.

    python3 scripts/pptx-fidelity/readback.py <file.pptx> [--source DIR] [--out DIR] [--label NAME]

Prints a Markdown table per slide: text boxes, boxes that do not wrap, bullets or numbers drawn as a text box of
their own, paragraphs with real bullets, whether the slide has a title placeholder, pictures and their alt text,
tables, notes; then the deck's sections and theme. With `--source DIR` holding the editor's picture of every
slide in deck order (`source-<id>.png`, as `pnpm e2e pptx_edit` saves them with its metrics.json), it also draws
every text box of the .pptx over that picture (`<label>-<n>.png` in `--out`): one outline per box, numbered, so
a title cut into three boxes shows as three. Needs python-pptx and Pillow; not part of `pnpm test`."""
import argparse
import json
import re
from pathlib import Path

from pptx import Presentation

MARKER = re.compile(r'^\s*([•◦▪]|\d+\.|[a-z]+\.|[ivxlc]+\.)\s*$', re.I)
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
P14 = '{http://schemas.microsoft.com/office/powerpoint/2010/main}'


def measure(prs):
    rows = []
    for i, slide in enumerate(prs.slides, 1):
        boxes = [s for s in slide.shapes if s.has_text_frame and s.text_frame.text.strip()]
        bodies = [s.text_frame._txBody.find(f'{A}bodyPr') for s in boxes]
        paras = [p for s in boxes for p in s.text_frame._txBody.findall(f'{A}p')]
        rows.append({
            'slide': i,
            'text_boxes': len(boxes),
            'no_wrap': sum(1 for b in bodies if b is not None and b.get('wrap') == 'none'),
            'marker_boxes': sum(1 for s in boxes if MARKER.match(s.text_frame.text)),
            'bulleted_paragraphs': sum(1 for p in paras if p.find(f'{A}pPr/{A}buChar') is not None or p.find(f'{A}pPr/{A}buAutoNum') is not None),
            'title': slide.shapes.title.text_frame.text.replace('\n', ' ')[:40] if slide.shapes.title is not None else '',
            'pictures': sum(1 for s in slide.shapes if s.shape_type == 13),
            # the writer's own asset file name is what PptxGenJS writes when it is given no alt text
            'alt_text': sum(1 for s in slide.shapes if s.shape_type == 13 and not re.fullmatch(r'(dc-asset-\d+\.\w+)?', s._element.find('.//{http://schemas.openxmlformats.org/presentationml/2006/main}cNvPr').get('descr', ''))),
            'tables': sum(1 for s in slide.shapes if s.has_table),
            'notes': slide.has_notes_slide and bool(slide.notes_slide.notes_text_frame.text.strip()),
            'boxes': [(int(s.left), int(s.top), int(s.width), int(s.height)) for s in boxes],
        })
    return rows


def deck_facts(prs, path):
    sections = [s.get('name') for s in prs.part._element.iter(f'{P14}section')]
    theme = None
    for rel in prs.slide_master.part.rels.values():
        if rel.reltype.endswith('/theme'):
            from lxml import etree
            root = etree.fromstring(rel.target_part.blob)
            theme = {
                'major': root.find(f'.//{A}majorFont/{A}latin').get('typeface'),
                'minor': root.find(f'.//{A}minorFont/{A}latin').get('typeface'),
                'colors': [c.get('val') or c.get('lastClr') for c in root.iter(f'{A}srgbClr', f'{A}sysClr')][:12],
            }
    return {'sections': sections, 'theme': theme}


def overlay(prs, rows, source: Path, out: Path, label: str):
    from PIL import Image, ImageDraw, ImageFont
    order = json.loads((source / 'metrics.json').read_text())['order'] if (source / 'metrics.json').exists() else None
    pictures = [source / f'source-{sid}.png' for sid in order] if order else sorted(source.glob('source-*.png'))
    out.mkdir(parents=True, exist_ok=True)
    width = prs.slide_width
    try:
        font = ImageFont.truetype('DejaVuSans-Bold.ttf', 22)
    except OSError:
        font = ImageFont.load_default()
    for row, picture in zip(rows, pictures):
        if not picture.exists(): continue
        img = Image.open(picture).convert('RGB').resize((1600, round(1600 * prs.slide_height / width)))
        draw = ImageDraw.Draw(img, 'RGBA')
        k = img.width / width
        for n, (x, y, w, h) in enumerate(row['boxes'], 1):
            box = [x * k, y * k, (x + w) * k, (y + h) * k]
            draw.rectangle(box, outline=(230, 30, 90, 255), width=3, fill=(230, 30, 90, 28))
            draw.rectangle([box[0], box[1] - 24, box[0] + 14 + 13 * len(str(n)), box[1]], fill=(230, 30, 90, 255))
            draw.text((box[0] + 5, box[1] - 24), str(n), fill='white', font=font)
        banner = f"{label} · slide {row['slide']}: {row['text_boxes']} text boxes, {row['no_wrap']} not wrapping, {row['marker_boxes']} bullet boxes, title: {'yes' if row['title'] else 'no'}"
        draw.rectangle([0, img.height - 40, img.width, img.height], fill=(0, 0, 0, 200))
        draw.text((12, img.height - 33), banner, fill='white', font=font)
        img.save(out / f'{label}-{row["slide"]}.png')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pptx')
    ap.add_argument('--source')
    ap.add_argument('--out', default='.')
    ap.add_argument('--label', default='export')
    ap.add_argument('--json')
    args = ap.parse_args()
    prs = Presentation(args.pptx)
    rows = measure(prs)
    facts = deck_facts(prs, args.pptx)
    cols = ['slide', 'text_boxes', 'no_wrap', 'marker_boxes', 'bulleted_paragraphs', 'title', 'pictures', 'alt_text', 'tables', 'notes']
    print('| ' + ' | '.join(cols) + ' |')
    print('|' + '---|' * len(cols))
    for r in rows: print('| ' + ' | '.join(str(r[c]) for c in cols) + ' |')
    total = {c: sum(r[c] for r in rows) for c in ['text_boxes', 'no_wrap', 'marker_boxes', 'bulleted_paragraphs', 'pictures', 'alt_text', 'tables']}
    print(f"\nTotal: {total}; titles: {sum(1 for r in rows if r['title'])}/{len(rows)}; notes: {sum(1 for r in rows if r['notes'])}")
    print(f"Sections: {facts['sections']}\nTheme: {facts['theme']}")
    if args.json:
        Path(args.json).write_text(json.dumps({'slides': rows, 'total': total, **facts}, indent=1, ensure_ascii=False))
    if args.source: overlay(prs, rows, Path(args.source), Path(args.out), args.label)


if __name__ == '__main__':
    main()
