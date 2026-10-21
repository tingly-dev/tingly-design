"""How close a PowerPoint round trip looks to its source, slide by slide.

    python3 scripts/pptx-fidelity/compare.py <project> [--out DIR] [--fonts]
    python3 scripts/pptx-fidelity/compare.py --import <file.pptx> [--out DIR]

Export (the default): the deck is the reference and its .pptx is the candidate.
Import (`--import`): the .pptx rendered by LibreOffice is the reference, and the project the
command line's `import` makes of it, exported as PDF by the editor, is the candidate.

Exports the project twice through the real command line (`export --as pdf`, the editor's
own rendering in Chrome, and `export --as pptx`), renders the .pptx with LibreOffice (an
independent reader: not PowerPoint, but not our code either), rasterizes both PDFs at the
same size and compares them pixel by pixel. Writes, per slide, the reference, the
rendering of the .pptx and a difference image, plus `report.md` with a score per slide:
the share of pixels whose colour differs by more than a small tolerance (anti-aliasing
and font hinting) and the mean colour difference. Lower is better; 0 is identical.

`--fonts` first downloads the deck's Google Fonts into ~/.local/share/fonts so
LibreOffice sets text in the same faces (otherwise most of the score is font
substitution, which says nothing about the export).

Needs: soffice (LibreOffice), pdftoppm (poppler), Python with Pillow and numpy, and
DC_CHROME pointing at a Chrome the command line can drive. Not part of `pnpm test`.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.request

import numpy as np
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[2]
WIDTH = 960
TOLERANCE = 48  # per-pixel max channel difference that still counts as "the same"


def run(cmd, **kw):
    subprocess.run(cmd, check=True, cwd=ROOT, **kw)


def project_dir(name: str) -> Path:
    out = subprocess.run(['pnpm', '-s', 'tingly-design', 'list', '--json'], cwd=ROOT, capture_output=True, text=True)
    try:
        for p in json.loads(out.stdout):
            if p.get('name') == name and p.get('dir'):
                return Path(p['dir'])
    except ValueError:
        pass
    return Path(os.environ.get('DC_PROJECTS', ROOT / 'projects')) / name


def install_fonts(deck: dict) -> None:
    target = Path.home() / '.local/share/fonts/pptx-fidelity'
    target.mkdir(parents=True, exist_ok=True)
    for face in (deck.get('faces') or {}).values():
        href = face.get('href')
        if not href or not href.startswith('https://fonts.googleapis.com/'):
            continue
        # an old user agent gets TrueType, which fontconfig reads
        req = urllib.request.Request(href, headers={'User-Agent': 'Mozilla/4.0'})
        css = urllib.request.urlopen(req, timeout=30).read().decode()
        for i, url in enumerate(re.findall(r'url\((https://fonts\.gstatic\.com/[^)]+)\)', css)):
            dest = target / f"{re.sub(r'[^A-Za-z0-9]+', '-', face.get('family', 'font'))}-{i}{Path(url).suffix or '.ttf'}"
            if not dest.exists():
                dest.write_bytes(urllib.request.urlopen(url, timeout=30).read())
    subprocess.run(['fc-cache', '-f', str(target)], check=False, capture_output=True)


def pages(pdf: Path, prefix: Path) -> list[Image.Image]:
    run(['pdftoppm', '-png', '-scale-to-x', str(WIDTH), '-scale-to-y', '-1', str(pdf), str(prefix)])
    files = sorted(prefix.parent.glob(prefix.name + '-*.png'), key=lambda f: int(f.stem.rsplit('-', 1)[1]))
    return [Image.open(f).convert('RGB') for f in files]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('project', nargs='?')
    ap.add_argument('--import', dest='source', default=None, help='a .pptx to import and compare with itself')
    ap.add_argument('--out', default=None)
    ap.add_argument('--fonts', action='store_true')
    a = ap.parse_args()
    if not a.project and not a.source:
        ap.error('name a project, or a .pptx with --import')
    with tempfile.TemporaryDirectory(prefix='pptx-fidelity-') as tmp:
        tmp = Path(tmp)
        if a.source:
            source = Path(a.source).resolve()
            made = subprocess.run(['pnpm', '-s', 'tingly-design', 'import', str(source)], cwd=ROOT, check=True, capture_output=True, text=True).stdout
            a.project = re.search(r'^Imported (\S+) into', made, re.M).group(1)
            print(made)
        out = Path(a.out or ROOT / 'scripts/pptx-fidelity/out' / a.project).resolve()
        out.mkdir(parents=True, exist_ok=True)
        deck = json.loads((project_dir(a.project) / 'deck.json').read_text())
        if a.fonts:
            install_fonts(deck)
        run(['pnpm', '-s', 'tingly-design', 'export', a.project, '--as', 'pdf', '--out', str(tmp / 'pdf')])
        pdf = next((tmp / 'pdf').glob('*.pdf'))
        if a.source:
            pptx = source
        else:
            run(['pnpm', '-s', 'tingly-design', 'export', a.project, '--as', 'pptx', '--out', str(tmp / 'pptx')])
            pptx = next((tmp / 'pptx').glob('*.pptx'))
            (out / 'export.pptx').write_bytes(pptx.read_bytes())
        run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', str(tmp / 'lo'), str(pptx)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        lo = next((tmp / 'lo').glob('*.pdf'))
        # the reference is what the user already trusts: the deck on export, the PowerPoint file on import
        ref, got = (pages(lo, tmp / 'ref'), pages(pdf, tmp / 'got')) if a.source else (pages(pdf, tmp / 'ref'), pages(lo, tmp / 'got'))
    rows = []
    for i, (r, g) in enumerate(zip(ref, got), 1):
        if g.size != r.size:
            g = g.resize(r.size)
        diff = np.asarray(ImageChops.difference(r, g), dtype=np.int16)
        off = (diff.max(axis=2) > TOLERANCE).mean() * 100
        mean = diff.mean()
        r.save(out / f'{i:02d}-{"pptx" if a.source else "deck"}.png')
        g.save(out / f'{i:02d}-{"deck" if a.source else "pptx"}.png')
        # differing pixels in red over a faded reference
        mask = Image.fromarray(((diff.max(axis=2) > TOLERANCE) * 255).astype('uint8'))
        faded = Image.blend(r, Image.new('RGB', r.size, 'white'), 0.75)
        faded.paste(Image.new('RGB', r.size, (220, 30, 30)), mask=mask)
        faded.save(out / f'{i:02d}-diff.png')
        rows.append((i, off, mean))
    order = deck.get('order') or []
    what = ('Reference: the .pptx rendered by LibreOffice. Candidate: the imported deck exported as PDF by the editor.' if a.source
            else 'Reference: the deck exported as PDF by the editor. Candidate: the .pptx rendered by LibreOffice.')
    lines = [f'# PPTX fidelity · {a.project}', '', f'{what} Tolerance {TOLERANCE}/255 per channel; {WIDTH}px wide.', '',
             '| # | slide | differing pixels | mean difference |', '|---|---|---|---|']
    for i, off, mean in rows:
        lines.append(f'| {i} | {order[i - 1] if i - 1 < len(order) else ""} | {off:.2f}% | {mean:.2f} |')
    if len(ref) != len(got):
        lines.append(f'\nPage counts differ: reference {len(ref)}, candidate {len(got)}.')
    avg = sum(r[1] for r in rows) / max(1, len(rows))
    lines.append(f'\nAverage differing pixels: **{avg:.2f}%**')
    (out / 'report.md').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))
    return 0


if __name__ == '__main__':
    sys.exit(main())
