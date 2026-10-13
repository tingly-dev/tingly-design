package docs

import (
	"bytes"
	"regexp"
	"strings"
	"sync"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	east "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
)

// The TypeScript core splits a tab with marked's lexer and compares blocks
// by marked's HTML. Here goldmark (CommonMark + GFM) plays both parts.

var md = goldmark.New(
	goldmark.WithExtensions(extension.GFM),
	goldmark.WithRendererOptions(html.WithUnsafe()),
)

type Block struct {
	Type  string
	Text  string
	Start int // byte offsets into the source
	End   int
}

type Blocks struct {
	Lead   string
	Blocks []Block
	Gaps   []string
}

func blockType(n ast.Node) string {
	switch n.(type) {
	case *ast.Heading:
		return "heading"
	case *ast.Paragraph, *ast.TextBlock:
		return "paragraph"
	case *ast.List:
		return "list"
	case *ast.FencedCodeBlock, *ast.CodeBlock:
		return "code"
	case *east.Table:
		return "table"
	case *ast.Blockquote:
		return "blockquote"
	case *ast.ThematicBreak:
		return "hr"
	case *ast.HTMLBlock:
		return "html"
	}
	return strings.ToLower(n.Kind().String())
}

// firstOffset is where a block begins in the source: its own position, or
// the first text found inside it.
func firstOffset(n ast.Node) int {
	// a table that takes the last line of a paragraph keeps the paragraph's position; its cells know better
	_, table := n.(*east.Table)
	if p := n.Pos(); p >= 0 && !table {
		return p
	}
	best := -1
	_ = ast.Walk(n, func(c ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering || (table && c == n) {
			return ast.WalkContinue, nil
		}
		off := -1
		if c.Type() == ast.TypeBlock && c.Lines().Len() > 0 {
			off = c.Lines().At(0).Start
		} else if t, ok := c.(*ast.Text); ok {
			off = t.Segment.Start
		} else if p := c.Pos(); p >= 0 {
			off = p
		}
		if off >= 0 && (best < 0 || off < best) {
			best = off
		}
		return ast.WalkContinue, nil
	})
	return best
}

func SplitBlocks(source string) Blocks {
	src := []byte(source)
	ctx := parser.NewContext()
	doc := md.Parser().Parse(text.NewReader(src), parser.WithContext(ctx))
	whole := func() Blocks {
		t := trimEndJS(source)
		if trimJS(source) == "" {
			return Blocks{}
		}
		return Blocks{Blocks: []Block{{Type: "paragraph", Text: t, Start: 0, End: len(t)}}, Gaps: []string{source[len(t):]}}
	}
	var starts []int
	var types []string
	for n := doc.FirstChild(); n != nil; n = n.NextSibling() {
		if _, ok := n.(*ast.LinkReferenceDefinition); ok {
			// marked's lexer drops a definition's text, and the core then keeps the tab as one block
			return whole()
		}
		off := firstOffset(n)
		if off < 0 {
			continue
		}
		// back to the start of its line: a list marker, '>' or indentation belongs to the block
		for off > 0 && src[off-1] != '\n' {
			off--
		}
		if len(starts) > 0 && off <= starts[len(starts)-1] {
			continue
		}
		starts = append(starts, off)
		types = append(types, blockType(n))
	}
	if len(ctx.References()) > 0 {
		return whole()
	}
	out := Blocks{}
	if len(starts) == 0 {
		out.Lead = source
		return out
	}
	out.Lead = source[:starts[0]]
	for i, st := range starts {
		end := len(source)
		if i+1 < len(starts) {
			end = starts[i+1]
		}
		raw := source[st:end]
		t := trimEndJS(raw)
		if trimJS(raw) == "" {
			if len(out.Blocks) > 0 {
				out.Gaps[len(out.Gaps)-1] += raw
			} else {
				out.Lead += raw
			}
			continue
		}
		out.Blocks = append(out.Blocks, Block{Type: types[i], Text: t, Start: st, End: st + len(t)})
		out.Gaps = append(out.Gaps, raw[len(t):])
	}
	return out
}

func JoinBlocks(b Blocks) string {
	var s strings.Builder
	s.WriteString(b.Lead)
	for i, x := range b.Blocks {
		s.WriteString(x.Text)
		if i < len(b.Gaps) {
			s.WriteString(b.Gaps[i])
		} else {
			s.WriteString("\n")
		}
	}
	return s.String()
}

var (
	keyCache   = map[string]string{}
	keyMu      sync.Mutex
	reTagGap   = regexp.MustCompile(`> <`)
	reBlockTag = regexp.MustCompile(` ?(</?(p|li|ul|ol|h\d|blockquote|table|thead|tbody|tr|td|th|pre)\b)`)
)

// BlockKey is what a block means: its rendered HTML, whitespace folded.
func BlockKey(t string) string {
	keyMu.Lock()
	if hit, ok := keyCache[t]; ok {
		keyMu.Unlock()
		return hit
	}
	keyMu.Unlock()
	var buf bytes.Buffer
	if err := md.Convert([]byte(t), &buf); err != nil {
		buf.Reset()
		buf.WriteString(t)
	}
	k := foldSpaceJS(buf.String())
	k = reTagGap.ReplaceAllString(k, "><")
	k = reBlockTag.ReplaceAllString(k, "$1")
	k = trimJS(k)
	keyMu.Lock()
	if len(keyCache) > 5000 {
		keyCache = map[string]string{}
	}
	keyCache[t] = k
	keyMu.Unlock()
	return k
}

// lcs is the longest common subsequence of two key lists, as index pairs in order.
func lcs(a, b []string) [][2]int {
	n, m := len(a), len(b)
	s := 0
	for s < n && s < m && a[s] == b[s] {
		s++
	}
	e := 0
	for e < n-s && e < m-s && a[n-1-e] == b[m-1-e] {
		e++
	}
	var pairs [][2]int
	for i := 0; i < s; i++ {
		pairs = append(pairs, [2]int{i, i})
	}
	A, B := a[s:n-e], b[s:m-e]
	if len(A) > 0 && len(B) > 0 {
		dp := make([][]int, len(A)+1)
		for i := range dp {
			dp[i] = make([]int, len(B)+1)
		}
		for i := len(A) - 1; i >= 0; i-- {
			for j := len(B) - 1; j >= 0; j-- {
				if A[i] == B[j] {
					dp[i][j] = dp[i+1][j+1] + 1
				} else {
					dp[i][j] = max(dp[i+1][j], dp[i][j+1])
				}
			}
		}
		i, j := 0, 0
		for i < len(A) && j < len(B) {
			if A[i] == B[j] {
				pairs = append(pairs, [2]int{i + s, j + s})
				i++
				j++
			} else if dp[i+1][j] >= dp[i][j+1] {
				i++
			} else {
				j++
			}
		}
	}
	for k := 0; k < e; k++ {
		pairs = append(pairs, [2]int{n - e + k, m - e + k})
	}
	return pairs
}

func keys(b Blocks) []string {
	out := make([]string, len(b.Blocks))
	for i, x := range b.Blocks {
		out[i] = BlockKey(x.Text)
	}
	return out
}

// MergeBlocks writes the editor's Markdown back onto what the file says.
func MergeBlocks(original, edited string) string {
	o := SplitBlocks(original)
	e := SplitBlocks(edited)
	pairs := lcs(keys(o), keys(e))
	same := map[int]int{}
	for _, p := range pairs {
		same[p[1]] = p[0]
	}
	was := map[int]int{}
	for k, v := range same {
		was[k] = v
	}
	pi, pj := -1, -1
	for _, p := range append(append([][2]int{}, pairs...), [2]int{len(o.Blocks), len(e.Blocks)}) {
		i, j := p[0], p[1]
		if i-pi == j-pj {
			for k := 1; k < i-pi; k++ {
				was[pj+k] = pi + k
			}
		}
		pi, pj = i, j
	}
	var out strings.Builder
	for j, b := range e.Blocks {
		i, has := was[j]
		if _, ok := same[j]; ok {
			out.WriteString(o.Blocks[i].Text)
		} else if has && o.Blocks[i].Type == b.Type {
			out.WriteString(RefineBlock(o.Blocks[i].Text, b.Text, b.Type))
		} else {
			out.WriteString(b.Text)
		}
		next, hasNext := was[j+1]
		var gap string
		switch {
		case has && hasNext && next == i+1:
			gap = o.Gaps[i]
		case j == len(e.Blocks)-1:
			if has && i == len(o.Blocks)-1 {
				gap = o.Gaps[i]
			} else {
				gap = "\n"
			}
		default:
			gap = "\n\n"
		}
		out.WriteString(gap)
	}
	if len(e.Blocks) > 0 {
		return o.Lead + out.String()
	}
	return out.String()
}

// tableCells splits a row on pipes that are not escaped (the TS uses a lookbehind, which RE2 lacks).
func tableCells(line string) []string {
	l := trimJS(line)
	l = strings.TrimPrefix(l, "|")
	if strings.HasSuffix(l, "|") && !strings.HasSuffix(l, `\|`) {
		l = l[:len(l)-1]
	}
	var cells []string
	st := 0
	for i := 0; i < len(l); i++ {
		if l[i] == '|' && (i == 0 || l[i-1] != '\\') {
			cells = append(cells, trimJS(l[st:i]))
			st = i + 1
		}
	}
	return append(cells, trimJS(l[st:]))
}

var (
	tableRule = regexp.MustCompile(`^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$`)
	bulletRe  = regexp.MustCompile(`^(\s*)([-*+])\s`)
	bulletSub = regexp.MustCompile(`^(\s*)([-*+])(\s)`)
)

func alignOf(l string) string {
	cs := tableCells(l)
	parts := make([]string, len(cs))
	for i, c := range cs {
		s := ""
		if strings.HasPrefix(c, ":") {
			s += "l"
		}
		if strings.HasSuffix(c, ":") {
			s += "r"
		}
		parts[i] = s
	}
	return strings.Join(parts, ",")
}

// RefineBlock keeps the lines of a changed block that did not change.
func RefineBlock(orig, next, typ string) string {
	ol := strings.Split(orig, "\n")
	nl := strings.Split(next, "\n")
	out := make([]string, len(nl))
	switch typ {
	case "table":
		used := map[int]bool{}
		pick := func(k int, test func(string) bool) int {
			if k < len(ol) && !used[k] && test(ol[k]) {
				return k
			}
			for m, l := range ol {
				if !used[m] && test(l) {
					return m
				}
			}
			return -1
		}
		for k, line := range nl {
			rule := tableRule.MatchString(line)
			want := strings.Join(tableCells(line), "\x00")
			al := alignOf(line)
			m := pick(k, func(l string) bool {
				if rule {
					return tableRule.MatchString(l) && alignOf(l) == al
				}
				return !tableRule.MatchString(l) && strings.Join(tableCells(l), "\x00") == want
			})
			if m >= 0 {
				used[m] = true
				out[k] = ol[m]
			} else if rule {
				out[k] = line
			} else {
				out[k] = "| " + strings.Join(tableCells(line), " | ") + " |"
			}
		}
	case "code":
		keep := map[int]int{}
		for _, p := range lcs(ol, nl) {
			keep[p[1]] = p[0]
		}
		for j, l := range nl {
			if i, ok := keep[j]; ok {
				out[j] = ol[i]
			} else {
				out[j] = l
			}
		}
	default:
		ok := make([]string, len(ol))
		for i, l := range ol {
			ok[i] = BlockKey(l)
		}
		nk := make([]string, len(nl))
		for i, l := range nl {
			nk[i] = BlockKey(l)
		}
		keep := map[int]int{}
		for _, p := range lcs(ok, nk) {
			keep[p[1]] = p[0]
		}
		bullets := map[int]string{}
		for _, l := range ol {
			if m := bulletRe.FindStringSubmatch(l); m != nil {
				if _, seen := bullets[U16Len(m[1])]; !seen {
					bullets[U16Len(m[1])] = m[2]
				}
			}
		}
		for j, l := range nl {
			if i, ok := keep[j]; ok {
				out[j] = ol[i]
				continue
			}
			out[j] = bulletSub.ReplaceAllStringFunc(l, func(all string) string {
				m := bulletSub.FindStringSubmatch(all)
				if b, ok := bullets[U16Len(m[1])]; ok {
					return m[1] + b + m[3]
				}
				return all
			})
		}
	}
	t := strings.Join(out, "\n")
	if BlockKey(t) == BlockKey(next) {
		return t
	}
	return next
}

// RebaseBlocks applies my change (basis → mine) to someone else's newer text.
func RebaseBlocks(basis, mine, theirs string) string {
	if basis == theirs {
		return mine
	}
	if basis == mine {
		return theirs
	}
	b, m, t := SplitBlocks(basis), SplitBlocks(mine), SplitBlocks(theirs)
	bk, mk, tk := keys(b), keys(m), keys(t)
	bm := lcs(bk, mk)
	bt := map[int]int{}
	for _, p := range lcs(bk, tk) {
		bt[p[0]] = p[1]
	}
	type hunk struct{ i0, i1, j0, j1 int }
	var hunks []hunk
	pi, pj := 0, 0
	for _, p := range append(append([][2]int{}, bm...), [2]int{len(bk), len(mk)}) {
		i, j := p[0], p[1]
		if i > pi || j > pj {
			hunks = append(hunks, hunk{pi, i, pj, j})
		}
		pi, pj = i+1, j+1
	}
	result := make([]string, len(t.Blocks))
	keep := make([]bool, len(t.Blocks))
	for i, x := range t.Blocks {
		result[i] = x.Text
		keep[i] = true
	}
	inserts := map[int][]string{}
	for _, h := range hunks {
		var mineTexts []string
		for _, x := range m.Blocks[h.j0:h.j1] {
			mineTexts = append(mineTexts, x.Text)
		}
		var gone []int
		for i := h.i0; i < h.i1; i++ {
			if ti, ok := bt[i]; ok {
				gone = append(gone, ti)
			}
		}
		for _, ti := range gone {
			keep[ti] = false
		}
		at := 0
		for i := h.i0 - 1; i >= 0; i-- {
			if ti, ok := bt[i]; ok {
				at = ti + 1
				break
			}
		}
		if len(gone) > 0 {
			at = gone[0]
			for _, g := range gone {
				at = min(at, g)
			}
		}
		inserts[at] = append(inserts[at], mineTexts...)
	}
	var out []string
	for k := 0; k <= len(result); k++ {
		out = append(out, inserts[k]...)
		if k < len(result) && keep[k] {
			out = append(out, result[k])
		}
	}
	return MergeBlocks(theirs, strings.Join(out, "\n\n")+"\n")
}

// ---------------------------------------------------------------- reading

type Heading struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
	Block int    `json:"block"`
}

func plain(n ast.Node, src []byte, b *strings.Builder) {
	for c := n.FirstChild(); c != nil; c = c.NextSibling() {
		switch x := c.(type) {
		case *ast.Text:
			b.Write(x.Segment.Value(src))
			if x.SoftLineBreak() || x.HardLineBreak() {
				b.WriteByte('\n')
			}
		case *ast.String:
			b.Write(x.Value)
		case *ast.RawHTML:
			for i := 0; i < x.Segments.Len(); i++ {
				s := x.Segments.At(i)
				b.Write(s.Value(src))
			}
		default:
			plain(c, src, b)
		}
	}
}

func OutlineOf(source string) []Heading {
	src := []byte(source)
	doc := md.Parser().Parse(text.NewReader(src))
	out := []Heading{}
	block := 0
	for n := doc.FirstChild(); n != nil; n = n.NextSibling() {
		if h, ok := n.(*ast.Heading); ok {
			var b strings.Builder
			plain(h, src, &b)
			out = append(out, Heading{Level: h.Level, Text: trimJS(b.String()), Block: block})
		}
		block++
	}
	return out
}

var (
	reFence = regexp.MustCompile("(?s)```.*?```")
	rePunct = regexp.MustCompile(`[#>*_` + "`" + `~|\[\]()!-]`)
	reCJK   = regexp.MustCompile(`[\x{3040}-\x{30FF}\x{3400}-\x{9FFF}\x{F900}-\x{FAFF}\x{AC00}-\x{D7AF}]`)
	reWord  = regexp.MustCompile(`[\p{L}\p{N}]+`)
)

// WordCount counts each CJK character as one word, other runs of letters and digits as one.
func WordCount(source string) int {
	t := reFence.ReplaceAllString(source, " ")
	t = rePunct.ReplaceAllString(t, " ")
	cjk := len(reCJK.FindAllStringIndex(t, -1))
	words := len(reWord.FindAllStringIndex(reCJK.ReplaceAllString(t, " "), -1))
	return cjk + words
}
