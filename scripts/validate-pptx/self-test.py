#!/usr/bin/env python3
"""Optional integration self-test. Uses only temporary copies of a schema-valid PPTX."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

HERE = Path(__file__).resolve().parent
SOURCE = (Path(sys.argv[1]) if len(sys.argv) > 1 else
          HERE.parents[1] / 'packages/core/test/fixtures/pptx-smoke/supported.pptx').resolve()
DOTNET = shutil.which('dotnet')
if not DOTNET:
    sys.exit('dotnet (.NET 10 SDK) is required for this optional self-test.')
if not SOURCE.is_file():
    sys.exit(f'Pass a schema-valid PPTX file: {SOURCE}')
original_hash = hashlib.sha256(SOURCE.read_bytes()).digest()
subprocess.run([DOTNET, 'build', str(HERE / 'validate-pptx.csproj'), '--nologo'], check=True)
command = [DOTNET, str(HERE / 'bin/Debug/net10.0/validate-pptx.dll')]


def run(args, expected):
    result = subprocess.run(command + [str(a) for a in args], capture_output=True, text=True)
    assert result.returncode == expected, (args, result.returncode, result.stdout, result.stderr)
    return result


run([SOURCE], 0)
run([], 2)
with tempfile.TemporaryDirectory(prefix='validate-pptx-self-test-') as temp:
    root = Path(temp)
    run([root / 'missing.pptx'], 1)
    run([root], 1)
    bad_zip = root / 'corrupt.pptx'
    bad_zip.write_bytes(b'not a ZIP package')
    run([bad_zip], 1)
    invalid = root / 'invalid-schema.pptx'
    with zipfile.ZipFile(SOURCE) as source, zipfile.ZipFile(invalid, 'w') as target:
        for entry in source.infolist():
            data = source.read(entry)
            if entry.filename == 'ppt/presentation.xml':
                xml = ET.fromstring(data)
                xml.set('definitelyNotASchemaAttribute', 'true')
                data = ET.tostring(xml, encoding='utf-8', xml_declaration=True)
            target.writestr(entry, data)
    invalid_result = run([invalid], 1)
    assert 'INVALID ' in invalid_result.stderr, invalid_result.stderr
    directory = root / 'nested'
    directory.mkdir()
    shutil.copyfile(SOURCE, directory / 'valid.PPTX')
    (directory / 'ignored-link.pptx').symlink_to(bad_zip)
    run([directory], 0)
    run([directory / 'ignored-link.pptx'], 1)
    many = root / 'many'
    many.mkdir()
    for i in range(110):
        shutil.copyfile(bad_zip, many / f'{i:03}.pptx')
    bounded = run([many], 1)
    assert len(bounded.stderr.splitlines()) == 101, bounded.stderr
    assert 'truncated' in bounded.stderr, bounded.stderr
    with zipfile.ZipFile(SOURCE) as source:
        embedded_names = [e.filename for e in source.infolist()
                          if e.filename.startswith('ppt/embeddings/') and e.filename.endswith('.xlsx')]
    if embedded_names:
        embedded_invalid = root / 'embedded-corrupt.pptx'
        with zipfile.ZipFile(SOURCE) as source, zipfile.ZipFile(embedded_invalid, 'w') as target:
            for entry in source.infolist():
                target.writestr(entry, b'not a ZIP' if entry.filename in embedded_names else source.read(entry))
        result = run([embedded_invalid], 1)
        assert '!/ppt/embeddings/' in result.stderr, result.stderr
    else:
        print('Embedded-XLSX negative check skipped: supplied PPTX has no chart workbook.')
assert hashlib.sha256(SOURCE.read_bytes()).digest() == original_hash, 'Source file changed'
print('PASS: valid package, invalid XML/ZIP, missing/empty input, recursive scan, symlink policy, diagnostic cap, read-only source.')
