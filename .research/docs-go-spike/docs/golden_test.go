package docs

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

// The golden file holds what the TypeScript core returns for every case
// (gen/fixtures.ts). This test reports how many the Go port matches byte for
// byte, per function, and shows the first differences of each.

type golden struct {
	Split []struct {
		Name, Src, Lead string
		Blocks          []struct{ Type, Text string }
		Gaps            []string
	}
	KeyPairs []struct {
		A, B string
		Same bool
	}
	Merge  []struct{ Name, Original, Edited, Out string }
	Rebase []struct {
		Name, Basis, Mine, Theirs, Out string
	}
	Refine  []struct{ Orig, Next, Type, Out string }
	Reading []struct {
		Name    string
		Outline []Heading
		Words   int
	}
	Quotes []struct {
		Text, Quote, Prefix, Suffix string
		Found                       *struct{ From, To int }
		At                          struct {
			From, To              int
			Quote, Prefix, Suffix string
		}
	}
	Docs []struct {
		Input, Out, Unique string
		Order              []string
	}
	Comments []struct{ Input, Out string }
}

func load(t *testing.T) golden {
	b, err := os.ReadFile("../testdata/docs.json")
	if err != nil {
		t.Skip("run gen/fixtures.ts first")
	}
	var g golden
	if err := json.Unmarshal(b, &g); err != nil {
		t.Fatal(err)
	}
	return g
}

type tally struct {
	name  string
	ok, n int
	diffs []string
}

func (s *tally) check(ok bool, show func() string) {
	s.n++
	if ok {
		s.ok++
	} else if len(s.diffs) < 3 {
		s.diffs = append(s.diffs, show())
	}
}

func clip(s string) string {
	if len(s) > 300 {
		return s[:300] + "…"
	}
	return s
}

func TestGolden(t *testing.T) {
	g := load(t)
	var all []*tally
	tal := func(name string) *tally { s := &tally{name: name}; all = append(all, s); return s }

	split := tal("splitBlocks")
	for _, c := range g.Split {
		b := SplitBlocks(c.Src)
		ok := b.Lead == c.Lead && len(b.Blocks) == len(c.Blocks) && strings.Join(b.Gaps, "|") == strings.Join(c.Gaps, "|")
		for i := 0; ok && i < len(b.Blocks); i++ {
			ok = b.Blocks[i].Type == c.Blocks[i].Type && b.Blocks[i].Text == c.Blocks[i].Text
		}
		split.check(ok, func() string {
			var got, want []string
			for _, x := range b.Blocks {
				got = append(got, x.Type+":"+clip(x.Text))
			}
			for _, x := range c.Blocks {
				want = append(want, x.Type+":"+clip(x.Text))
			}
			for i := 0; i < len(got) && i < len(want); i++ {
				if got[i] != want[i] {
					return fmt.Sprintf("%s block %d\n  go: %q\n  ts: %q", c.Name, i, got[i], want[i])
				}
			}
			return fmt.Sprintf("%s: go %d blocks, ts %d blocks", c.Name, len(got), len(want))
		})
	}

	keys := tal("blockKey equality")
	for _, c := range g.KeyPairs {
		same := BlockKey(c.A) == BlockKey(c.B)
		keys.check(same == c.Same, func() string {
			return fmt.Sprintf("ts same=%v go same=%v\n  a: %q\n  b: %q\n  go a: %q\n  go b: %q", c.Same, same, clip(c.A), clip(c.B), clip(BlockKey(c.A)), clip(BlockKey(c.B)))
		})
	}

	merge := tal("mergeBlocks")
	for _, c := range g.Merge {
		got := MergeBlocks(c.Original, c.Edited)
		merge.check(got == c.Out, func() string {
			return fmt.Sprintf("%s\n  go: %q\n  ts: %q", c.Name, clip(firstDiff(got, c.Out)), clip(firstDiff(c.Out, got)))
		})
	}

	rebase := tal("rebaseBlocks")
	for _, c := range g.Rebase {
		got := RebaseBlocks(c.Basis, c.Mine, c.Theirs)
		rebase.check(got == c.Out, func() string {
			return fmt.Sprintf("%s\n  go: %q\n  ts: %q", c.Name, clip(firstDiff(got, c.Out)), clip(firstDiff(c.Out, got)))
		})
	}

	refine := tal("refineBlock")
	for _, c := range g.Refine {
		got := RefineBlock(c.Orig, c.Next, c.Type)
		refine.check(got == c.Out, func() string { return fmt.Sprintf("%s\n  go: %q\n  ts: %q", c.Type, clip(got), clip(c.Out)) })
	}

	outline := tal("outlineOf")
	words := tal("wordCount")
	for i, c := range g.Reading {
		src := g.Split[i].Src
		got := OutlineOf(src)
		ok := len(got) == len(c.Outline)
		for i := 0; ok && i < len(got); i++ {
			ok = got[i] == c.Outline[i]
		}
		outline.check(ok, func() string {
			for i := 0; i < len(got) && i < len(c.Outline); i++ {
				if got[i] != c.Outline[i] {
					return fmt.Sprintf("%s\n  go: %+v\n  ts: %+v", c.Name, got[i], c.Outline[i])
				}
			}
			return fmt.Sprintf("%s: go %d headings, ts %d", c.Name, len(got), len(c.Outline))
		})
		w := WordCount(src)
		words.check(w == c.Words, func() string { return fmt.Sprintf("%s go %d ts %d", c.Name, w, c.Words) })
	}

	quotes := tal("findQuote/quoteAt")
	for _, c := range g.Quotes {
		f, to, ok := FindQuote(c.Text, c.Quote, c.Prefix, c.Suffix)
		q, p, s := QuoteAt(c.Text, c.At.From, c.At.To)
		good := q == c.At.Quote && p == c.At.Prefix && s == c.At.Suffix && ok == (c.Found != nil) && (!ok || (f == c.Found.From && to == c.Found.To))
		quotes.check(good, func() string { return fmt.Sprintf("quote %q go %d-%d ts %+v", c.Quote, f, to, c.Found) })
	}

	docs := tal("parse/stringify doc.json")
	for _, c := range g.Docs {
		d := ParseDoc(c.Input)
		got := d.StringifyDoc()
		ok := got == c.Out && strings.Join(d.TabOrder(), ",") == strings.Join(c.Order, ",") && d.UniqueTabID("Intro Tab!") == c.Unique
		docs.check(ok, func() string { return fmt.Sprintf("%q\n  go: %q\n  ts: %q", clip(c.Input), clip(got), clip(c.Out)) })
	}

	comments := tal("parse/stringify comments.json")
	for _, c := range g.Comments {
		got := NormalizeComments(c.Input)
		comments.check(got == c.Out, func() string {
			return fmt.Sprintf("go: %q\n  ts: %q", clip(firstDiff(got, c.Out)), clip(firstDiff(c.Out, got)))
		})
	}

	var report strings.Builder
	for _, s := range all {
		fmt.Fprintf(&report, "%-32s %4d / %-4d %6.1f%%\n", s.name, s.ok, s.n, 100*float64(s.ok)/float64(max(s.n, 1)))
	}
	for _, s := range all {
		for _, d := range s.diffs {
			fmt.Fprintf(&report, "\n[%s] %s\n", s.name, d)
		}
	}
	t.Log("\n" + report.String())
	_ = os.WriteFile("../testdata/report.txt", []byte(report.String()), 0o644)
}

// firstDiff is a from the first byte where it differs from b, with a little before it.
func firstDiff(a, b string) string {
	i := 0
	for i < len(a) && i < len(b) && a[i] == b[i] {
		i++
	}
	st := max(0, i-40)
	return a[st:]
}
