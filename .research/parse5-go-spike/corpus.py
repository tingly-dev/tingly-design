# Builds the two corpora: html5lib tree-construction inputs (checkout the commit
# before 224991e "Tree construction tests have moved to WPT") and the repo's own
# canvas/slide templates. Usage: python3 corpus.py <html5lib-tests dir> <tingly-design dir>
import glob, json, re, sys
h5, repo = sys.argv[1], sys.argv[2]
with open('corpus5lib.jsonl', 'w') as out:
    for f in sorted(glob.glob(h5 + '/tree-construction/*.dat')):
        txt = open(f, encoding='utf-8', errors='surrogatepass').read()
        for t in re.split(r'\n\n(?=#data\n)', '\n' + txt):
            m = re.search(r'#data\n(.*?)\n#errors', t, re.S)
            if m:
                out.write(json.dumps(m.group(1)) + '\n')
with open('corpusrepo.jsonl', 'w') as out:
    for f in glob.glob(repo + '/**/*.html', recursive=True):
        if 'node_modules' in f or '/artifact/' in f:
            continue
        s = open(f, encoding='utf-8').read()
        m = re.search(r'<x-dc(\s[^>]*)?>', s, re.I)
        c = s.lower().rfind('</x-dc>')
        if m and c > m.end():
            out.write(json.dumps(s[m.end():c]) + '\n')
        elif re.match(r'^(?:\s|<!--[\s\S]*?-->)*<section[\s>]', s, re.I):
            out.write(json.dumps(s) + '\n')
