//go:build js && wasm

// The docs port as a WebAssembly module: globalThis.goDocs.{merge, rebase, split, outline, words}.
// Strings in, strings (or JSON) out, the way an editor would call it.
package main

import (
	"encoding/json"
	"syscall/js"

	"docs-go-spike/docs"
)

func main() {
	str := func(f func(a []js.Value) any) js.Func {
		return js.FuncOf(func(_ js.Value, a []js.Value) any { return f(a) })
	}
	api := map[string]any{
		"merge":  str(func(a []js.Value) any { return docs.MergeBlocks(a[0].String(), a[1].String()) }),
		"rebase": str(func(a []js.Value) any { return docs.RebaseBlocks(a[0].String(), a[1].String(), a[2].String()) }),
		"split": str(func(a []js.Value) any {
			b, _ := json.Marshal(docs.SplitBlocks(a[0].String()))
			return string(b)
		}),
		"outline": str(func(a []js.Value) any {
			b, _ := json.Marshal(docs.OutlineOf(a[0].String()))
			return string(b)
		}),
		"words": str(func(a []js.Value) any { return docs.WordCount(a[0].String()) }),
	}
	js.Global().Set("goDocs", js.ValueOf(api))
	select {}
}
