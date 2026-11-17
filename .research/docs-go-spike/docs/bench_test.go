package docs

import (
	"os"
	"strings"
	"testing"
)

// The same edits cmd/bench/bench.mjs times, natively: what a Go server would spend.
func benchDoc(b *testing.B, k int) (src, edited, theirs string) {
	base, err := os.ReadFile("../../../docs/en/architecture.md")
	if err != nil {
		b.Skip(err)
	}
	parts := make([]string, k)
	for i := range parts {
		parts[i] = string(base)
	}
	src = strings.Join(parts, "\n\n")
	at := strings.Index(src[len(src)/2:], "\n\n") + len(src)/2 + 2
	return src, src[:at] + "Changed. " + src[at:], "New first paragraph.\n\n" + src
}

func benchMerge(b *testing.B, k int) {
	src, edited, _ := benchDoc(b, k)
	for i := 0; i < b.N; i++ {
		MergeBlocks(src, edited)
	}
}

func benchRebase(b *testing.B, k int) {
	src, edited, theirs := benchDoc(b, k)
	for i := 0; i < b.N; i++ {
		RebaseBlocks(src, edited, theirs)
	}
}

func BenchmarkMerge7K(b *testing.B)    { benchMerge(b, 1) }
func BenchmarkMerge28K(b *testing.B)   { benchMerge(b, 4) }
func BenchmarkMerge111K(b *testing.B)  { benchMerge(b, 16) }
func BenchmarkRebase7K(b *testing.B)   { benchRebase(b, 1) }
func BenchmarkRebase28K(b *testing.B)  { benchRebase(b, 4) }
func BenchmarkRebase111K(b *testing.B) { benchRebase(b, 16) }
