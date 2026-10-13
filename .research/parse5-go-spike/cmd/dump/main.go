package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"golang.org/x/net/html/atom"
	html "spike/xhtml"
)

func sp(s *html.Span) string {
	if s == nil {
		return "-"
	}
	return fmt.Sprintf("%d-%d", s.Start, s.End)
}

func dump(b *strings.Builder, n *html.Node, d int) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		ind := strings.Repeat(" ", d)
		loc := "NOLOC"
		if c.Loc != nil {
			loc = fmt.Sprintf("%d-%d", c.Loc.Start, c.Loc.End)
		}
		switch c.Type {
		case html.TextNode:
			fmt.Fprintf(b, "%s#text %s\n", ind, loc)
		case html.CommentNode:
			fmt.Fprintf(b, "%s#comment %s\n", ind, loc)
		case html.ElementNode:
			ns := c.Namespace
			if ns == "" {
				ns = "html"
			}
			st, et, at := "-", "-", ""
			if c.Loc != nil {
				st, et = sp(c.Loc.StartTag), sp(c.Loc.EndTag)
				for i, a := range c.Attr {
					k := a.Key
					if a.Namespace != "" {
						k = a.Namespace + ":" + k
					}
					at += fmt.Sprintf(" %s@%s", k, sp(&c.Loc.Attrs[i]))
				}
			}
			fmt.Fprintf(b, "%s%s[%s] %s st=%s et=%s%s\n", ind, c.Data, ns, loc, st, et, at)
			dump(b, c, d+1)
		}
	}
}

func main() {
	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 1<<26), 1<<26)
	out := json.NewEncoder(os.Stdout)
	ctx := &html.Node{Type: html.ElementNode, Data: "template", DataAtom: atom.Template}
	for in.Scan() {
		var src string
		json.Unmarshal(in.Bytes(), &src)
		var b strings.Builder
		nodes, err := html.ParseFragment(strings.NewReader(src), ctx)
		if err != nil {
			b.WriteString("ERR " + err.Error())
		}
		root := &html.Node{Type: html.DocumentNode}
		for _, n := range nodes {
			root.AppendChild(n)
		}
		dump(&b, root, 0)
		out.Encode(b.String())
	}
}
