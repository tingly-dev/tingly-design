package html

import "strings"

// Span is a half-open byte range in the parsed input.
type Span struct{ Start, End int }

// Loc says which bytes of the input a node came from. Implied nodes have none.
type Loc struct {
	Span
	StartTag *Span
	EndTag   *Span
	Attrs    []Span // aligned with Node.Attr: the whole name="value" text
}

// AttrSpans returns, for each attribute Token() reports, its range relative to the token's raw start.
func (z *Tokenizer) AttrSpans() []Span {
	out := make([]Span, len(z.attr))
	for i, a := range z.attr {
		end := a[0].end
		if a[1].end > end {
			end = a[1].end
			if end < len(z.buf) && a[1].start > 0 && (z.buf[a[1].start-1] == '"' || z.buf[a[1].start-1] == '\'') && z.buf[end] == z.buf[a[1].start-1] {
				end++
			}
		}
		out[i] = Span{a[0].start - z.raw.start, end - z.raw.start}
	}
	return out
}

func (p *parser) tokLoc() *Loc {
	if p.implied {
		return nil
	}
	return &Loc{Span: Span{p.tokStart, p.tokEnd}}
}

func (p *parser) elementLoc() *Loc {
	l := p.tokLoc()
	if l == nil {
		return nil
	}
	l.StartTag = &Span{p.tokStart, p.tokEnd}
	for _, a := range p.attrSpans {
		l.Attrs = append(l.Attrs, Span{p.tokStart + a.Start, p.tokStart + a.End})
	}
	return l
}

// closePopped records where each element that left the stack of open elements ended.
func (p *parser) closePopped(before []*Node) {
	in := make(map[*Node]bool, len(p.oe))
	for _, n := range p.oe {
		in[n] = true
	}
	if p.tok.Type == ErrorToken {
		for _, n := range p.oe {
			if n.Loc != nil && n.Loc.End < p.tokStart {
				n.Loc.End = p.tokStart
			}
		}
	}
	for i := 0; i < len(before); i++ {
		n := before[i]
		if in[n] || n.Loc == nil || n.Loc.EndTag != nil || n.closed {
			continue
		}
		n.closed = true
		if p.tok.Type == EndTagToken && !p.implied && strings.EqualFold(n.Data, p.tok.Data) && !p.endUsed {
			n.Loc.EndTag = &Span{p.tokStart, p.tokEnd}
			n.Loc.End = p.tokEnd
			p.endUsed = true
		} else if n.Loc.End < p.tokStart {
			n.Loc.End = p.tokStart
		}
	}
}

func cloneLoc(l *Loc) *Loc {
	if l == nil {
		return nil
	}
	c := *l
	c.EndTag = nil
	return &c
}
