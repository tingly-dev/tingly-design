package docs

import (
	"regexp"
	"strconv"
	"strings"
)

// doc.json and comments.json: read leniently, written as JSON.stringify(x, null, 2).

var tabIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

type Tab struct {
	ID     string
	Title  string
	Parent string
	HasPar bool
}

type Doc struct {
	raw  *Value
	Tabs []Tab
}

func isStr(v *Value) bool { return v != nil && v.Kind == 's' }

func asObject(text string) *Value {
	v, ok := ParseJSON(text)
	if !ok || v == nil || v.Kind != 'o' {
		return NewObject()
	}
	return v
}

// ParseDoc reads doc.json; the result keeps unknown fields and their order.
func ParseDoc(text string) *Doc {
	raw := asObject(text)
	var tabs []Tab
	if ts := raw.Get("tabs"); ts != nil && ts.Kind == 'a' {
		for _, t := range ts.Arr {
			id := t.Get("id")
			if t == nil || t.Kind != 'o' || !isStr(id) || !tabIDRe.MatchString(id.Str) {
				continue
			}
			dup := false
			for _, x := range tabs {
				if x.ID == id.Str {
					dup = true
				}
			}
			if dup {
				continue
			}
			tab := Tab{ID: id.Str, Title: id.Str}
			if ti := t.Get("title"); isStr(ti) && trimJS(ti.Str) != "" {
				tab.Title = ti.Str
			}
			if p := t.Get("parent"); isStr(p) {
				tab.Parent, tab.HasPar = p.Str, true
			}
			tabs = append(tabs, tab)
		}
	}
	for i := range tabs {
		if !tabs[i].HasPar {
			continue
		}
		ok := false
		for _, p := range tabs {
			if p.ID == tabs[i].Parent && !p.HasPar {
				ok = true
			}
		}
		if !ok {
			tabs[i].Parent, tabs[i].HasPar = "", false
		}
	}
	return &Doc{raw: raw, Tabs: tabs}
}

func (d *Doc) StringifyDoc() string {
	o := NewObject()
	for _, k := range d.raw.Keys {
		o.Set(k, d.raw.Props[k])
	}
	title := "Untitled"
	if t := d.raw.Get("title"); isStr(t) && trimJS(t.Str) != "" {
		title = t.Str
	}
	o.Set("title", Str(title))
	arr := &Value{Kind: 'a'}
	for _, t := range d.Tabs {
		x := NewObject()
		x.Set("id", Str(t.ID))
		x.Set("title", Str(t.Title))
		if t.HasPar {
			x.Set("parent", Str(t.Parent))
		}
		arr.Arr = append(arr.Arr, x)
	}
	o.Set("tabs", arr)
	s := d.raw.Get("settings")
	str := func(k, yes, want, no string) string {
		if v := s.Get(k); isStr(v) && v.Str == yes {
			return want
		}
		return no
	}
	set := NewObject()
	set.Set("headingFont", Str(str("headingFont", "serif", "serif", "sans")))
	set.Set("bodyFont", Str(str("bodyFont", "serif", "serif", "sans")))
	set.Set("width", Str(str("width", "wide", "wide", "default")))
	lang := "zh-CN"
	if v := s.Get("lang"); isStr(v) && v.Str != "" {
		lang = v.Str
	}
	set.Set("lang", Str(lang))
	o.Set("settings", set)
	return Stringify(o) + "\n"
}

// TabOrder is each tab, then its subtabs.
func (d *Doc) TabOrder() []string {
	var out []string
	for _, t := range d.Tabs {
		if t.HasPar {
			continue
		}
		out = append(out, t.ID)
		for _, c := range d.Tabs {
			if c.HasPar && c.Parent == t.ID {
				out = append(out, c.ID)
			}
		}
	}
	return out
}

var (
	reNotID  = regexp.MustCompile(`[^a-z0-9_-]+`)
	reDashes = regexp.MustCompile(`^-+|-+$`)
)

func (d *Doc) UniqueTabID(base string) string {
	stem := reDashes.ReplaceAllString(reNotID.ReplaceAllString(strings.ToLower(base), "-"), "")
	if len(stem) > 40 {
		stem = stem[:40]
	}
	if stem == "" {
		stem = "tab"
	}
	id := stem
	taken := func(id string) bool {
		for _, t := range d.Tabs {
			if t.ID == id {
				return true
			}
		}
		return false
	}
	for n := 2; taken(id); n++ {
		id = stem + "-" + strconv.Itoa(n)
	}
	return id
}

// ParseComments reads comments.json and writes it back in the core's shape.
func NormalizeComments(text string) string {
	raw := asObject(text)
	threads := &Value{Kind: 'a'}
	if ts := raw.Get("threads"); ts != nil && ts.Kind == 'a' {
		for _, t := range ts.Arr {
			id, tab, quote := t.Get("id"), t.Get("tab"), t.Get("quote")
			if t == nil || !isStr(id) || !isStr(tab) || !isStr(quote) {
				continue
			}
			cs := &Value{Kind: 'a'}
			if list := t.Get("comments"); list != nil && list.Kind == 'a' {
				n := 0
				for _, c := range list.Arr {
					if c == nil || c.Kind != 'o' || !isStr(c.Get("text")) {
						continue
					}
					x := NewObject()
					cid := id.Str + "-" + strconv.Itoa(n)
					if v := c.Get("id"); isStr(v) {
						cid = v.Str
					}
					author := "?"
					if v := c.Get("author"); isStr(v) {
						author = v.Str
					}
					at := ""
					if v := c.Get("at"); isStr(v) {
						at = v.Str
					}
					x.Set("id", Str(cid))
					x.Set("author", Str(author))
					x.Set("text", c.Get("text"))
					x.Set("at", Str(at))
					cs.Arr = append(cs.Arr, x)
					n++
				}
			}
			th := NewObject()
			th.Set("id", id)
			th.Set("tab", tab)
			th.Set("quote", quote)
			if v := t.Get("prefix"); isStr(v) {
				th.Set("prefix", v)
			}
			if v := t.Get("suffix"); isStr(v) {
				th.Set("suffix", v)
			}
			if v := t.Get("resolved"); v != nil && v.Kind == 'b' && v.Bool {
				th.Set("resolved", Bool(true))
			}
			th.Set("comments", cs)
			threads.Arr = append(threads.Arr, th)
		}
	}
	o := NewObject()
	for _, k := range raw.Keys {
		o.Set(k, raw.Props[k])
	}
	o.Set("threads", threads)
	return Stringify(o) + "\n"
}

// FindQuote returns UTF-16 offsets, as the editor counts them.
func FindQuote(textS, quote, prefix, suffix string) (from, to int, ok bool) {
	if quote == "" {
		return 0, 0, false
	}
	t, q, pre, suf := toU16(textS), toU16(quote), toU16(prefix), toU16(suffix)
	best, bestScore := -1, -1
	for at := t.indexOf(q, 0); at >= 0; at = t.indexOf(q, at+1) {
		score := 0
		for k := 1; k <= len(pre) && at-k >= 0 && t[at-k] == pre[len(pre)-k]; k++ {
			score++
		}
		for k := 0; k < len(suf) && at+len(q)+k < len(t) && t[at+len(q)+k] == suf[k]; k++ {
			score++
		}
		if best < 0 || score > bestScore {
			best, bestScore = at, score
		}
	}
	if best < 0 {
		return 0, 0, false
	}
	return best, best + len(q), true
}

func QuoteAt(textS string, from, to int) (quote, prefix, suffix string) {
	t := toU16(textS)
	clamp := func(n int) int { return max(0, min(n, len(t))) }
	return t[clamp(from):clamp(to)].String(), t[clamp(from-24):clamp(from)].String(), t[clamp(to):clamp(to+24)].String()
}

func NewDocTab(title string) string { return "# " + title + "\n\n" }
