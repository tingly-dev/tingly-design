package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"golang.org/x/net/html/atom"
	"os"
	html "spike/xhtml"
	"strings"
	"time"
)

func main() {
	for _, f := range os.Args[1:] {
		fh, _ := os.Open(f)
		sc := bufio.NewScanner(fh)
		sc.Buffer(make([]byte, 1<<26), 1<<26)
		var L []string
		for sc.Scan() {
			var s string
			json.Unmarshal(sc.Bytes(), &s)
			L = append(L, s)
		}
		ctx := &html.Node{Type: html.ElementNode, Data: "template", DataAtom: atom.Template}
		t := time.Now()
		for _, s := range L {
			html.ParseFragment(strings.NewReader(s), ctx)
		}
		fmt.Printf("%s go-fork ms/doc %.3f\n", f, float64(time.Since(t).Microseconds())/1000/float64(len(L)))
	}
}
