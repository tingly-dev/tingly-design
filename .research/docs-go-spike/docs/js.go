package docs

import (
	"math"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// JavaScript semantics the TypeScript core relies on without saying so:
// what \s and trim() call whitespace, UTF-16 string offsets, and how
// JSON.parse / JSON.stringify order keys and write numbers. A Go port has
// to reproduce each of them to give the same bytes.

// isJSSpace is JavaScript's \s: WhiteSpace and LineTerminator.
func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
		return true
	}
	return r >= 0x2000 && r <= 0x200A
}

func trimEndJS(s string) string { return strings.TrimRightFunc(s, isJSSpace) }
func trimJS(s string) string    { return strings.TrimFunc(s, isJSSpace) }

// foldSpaceJS is s.replace(/\s+/g, ' ').
func foldSpaceJS(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	in := false
	for _, r := range s {
		if isJSSpace(r) {
			if !in {
				b.WriteByte(' ')
			}
			in = true
			continue
		}
		in = false
		b.WriteRune(r)
	}
	return b.String()
}

// u16 is a string as JavaScript indexes it.
type u16 []uint16

func toU16(s string) u16     { return utf16.Encode([]rune(s)) }
func (u u16) String() string { return string(utf16.Decode(u)) }

// U16Len is s.length in JavaScript.
func U16Len(s string) int { return len(toU16(s)) }

func (u u16) indexOf(q u16, from int) int {
	if from < 0 {
		from = 0
	}
	for i := from; i+len(q) <= len(u); i++ {
		match := true
		for k := range q {
			if u[i+k] != q[k] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

// ---------------------------------------------------------------- JSON

// Value is a parsed JSON value that keeps JavaScript's object key order.
type Value struct {
	Kind  byte // 'n' null, 'b' bool, 'f' number, 's' string, 'a' array, 'o' object
	Bool  bool
	Num   float64
	Str   string
	Arr   []*Value
	Keys  []string
	Props map[string]*Value
}

func NewObject() *Value   { return &Value{Kind: 'o', Props: map[string]*Value{}} }
func Str(s string) *Value { return &Value{Kind: 's', Str: s} }
func Bool(b bool) *Value  { return &Value{Kind: 'b', Bool: b} }
func (v *Value) Get(k string) *Value {
	if v == nil || v.Kind != 'o' {
		return nil
	}
	return v.Props[k]
}

// Set assigns a property the way JavaScript does: a new key goes last
// (after integer keys are moved first, see keyOrder), an existing key keeps its place.
func (v *Value) Set(k string, x *Value) {
	if _, ok := v.Props[k]; !ok {
		v.Keys = append(v.Keys, k)
	}
	v.Props[k] = x
}

func (v *Value) Delete(k string) {
	if _, ok := v.Props[k]; !ok {
		return
	}
	delete(v.Props, k)
	for i, x := range v.Keys {
		if x == k {
			v.Keys = append(v.Keys[:i:i], v.Keys[i+1:]...)
			break
		}
	}
}

// keyOrder is JavaScript's own-key order: array-index keys ascending, then the rest as inserted.
func (v *Value) keyOrder() []string {
	var idx, rest []string
	for _, k := range v.Keys {
		if isArrayIndex(k) {
			idx = append(idx, k)
		} else {
			rest = append(rest, k)
		}
	}
	if len(idx) == 0 {
		return rest
	}
	for i := 1; i < len(idx); i++ {
		for j := i; j > 0; j-- {
			a, _ := strconv.ParseUint(idx[j-1], 10, 64)
			b, _ := strconv.ParseUint(idx[j], 10, 64)
			if a <= b {
				break
			}
			idx[j-1], idx[j] = idx[j], idx[j-1]
		}
	}
	return append(idx, rest...)
}

func isArrayIndex(k string) bool {
	if k == "" || len(k) > 10 || (len(k) > 1 && k[0] == '0') {
		return false
	}
	n, err := strconv.ParseUint(k, 10, 64)
	return err == nil && n < 4294967295
}

// ParseJSON is JSON.parse; ok is false where JSON.parse would throw.
func ParseJSON(s string) (v *Value, ok bool) {
	p := &jparser{s: s}
	defer func() {
		if recover() != nil {
			v, ok = nil, false
		}
	}()
	p.ws()
	v = p.value()
	p.ws()
	if p.i != len(p.s) {
		return nil, false
	}
	return v, true
}

type jparser struct {
	s string
	i int
}

func (p *jparser) fail() { panic("json") }

func (p *jparser) ws() {
	for p.i < len(p.s) {
		switch p.s[p.i] {
		case ' ', '\t', '\n', '\r':
			p.i++
		default:
			return
		}
	}
}

func (p *jparser) value() *Value {
	if p.i >= len(p.s) {
		p.fail()
	}
	switch c := p.s[p.i]; {
	case c == '{':
		p.i++
		o := NewObject()
		p.ws()
		if p.i < len(p.s) && p.s[p.i] == '}' {
			p.i++
			return o
		}
		for {
			p.ws()
			if p.i >= len(p.s) || p.s[p.i] != '"' {
				p.fail()
			}
			k := p.str()
			p.ws()
			if p.i >= len(p.s) || p.s[p.i] != ':' {
				p.fail()
			}
			p.i++
			p.ws()
			o.Set(k, p.value())
			p.ws()
			if p.i < len(p.s) && p.s[p.i] == ',' {
				p.i++
				continue
			}
			if p.i < len(p.s) && p.s[p.i] == '}' {
				p.i++
				return o
			}
			p.fail()
		}
	case c == '[':
		p.i++
		a := &Value{Kind: 'a'}
		p.ws()
		if p.i < len(p.s) && p.s[p.i] == ']' {
			p.i++
			return a
		}
		for {
			p.ws()
			a.Arr = append(a.Arr, p.value())
			p.ws()
			if p.i < len(p.s) && p.s[p.i] == ',' {
				p.i++
				continue
			}
			if p.i < len(p.s) && p.s[p.i] == ']' {
				p.i++
				return a
			}
			p.fail()
		}
	case c == '"':
		return Str(p.str())
	case strings.HasPrefix(p.s[p.i:], "true"):
		p.i += 4
		return Bool(true)
	case strings.HasPrefix(p.s[p.i:], "false"):
		p.i += 5
		return Bool(false)
	case strings.HasPrefix(p.s[p.i:], "null"):
		p.i += 4
		return &Value{Kind: 'n'}
	default:
		st := p.i
		if p.i < len(p.s) && p.s[p.i] == '-' {
			p.i++
		}
		digits := func() int {
			n := 0
			for p.i < len(p.s) && p.s[p.i] >= '0' && p.s[p.i] <= '9' {
				p.i++
				n++
			}
			return n
		}
		if p.i < len(p.s) && p.s[p.i] == '0' {
			p.i++
		} else if digits() == 0 {
			p.fail()
		}
		if p.i < len(p.s) && p.s[p.i] == '.' {
			p.i++
			if digits() == 0 {
				p.fail()
			}
		}
		if p.i < len(p.s) && (p.s[p.i] == 'e' || p.s[p.i] == 'E') {
			p.i++
			if p.i < len(p.s) && (p.s[p.i] == '+' || p.s[p.i] == '-') {
				p.i++
			}
			if digits() == 0 {
				p.fail()
			}
		}
		f, err := strconv.ParseFloat(p.s[st:p.i], 64)
		if err != nil && !math.IsInf(f, 0) {
			p.fail()
		}
		return &Value{Kind: 'f', Num: f}
	}
}

func (p *jparser) str() string {
	p.i++ // opening quote
	var units []uint16
	for {
		if p.i >= len(p.s) {
			p.fail()
		}
		c := p.s[p.i]
		switch {
		case c == '"':
			p.i++
			return string(utf16.Decode(units))
		case c < 0x20:
			p.fail()
		case c == '\\':
			p.i++
			if p.i >= len(p.s) {
				p.fail()
			}
			e := p.s[p.i]
			p.i++
			switch e {
			case '"', '\\', '/':
				units = append(units, uint16(e))
			case 'b':
				units = append(units, '\b')
			case 'f':
				units = append(units, '\f')
			case 'n':
				units = append(units, '\n')
			case 'r':
				units = append(units, '\r')
			case 't':
				units = append(units, '\t')
			case 'u':
				if p.i+4 > len(p.s) {
					p.fail()
				}
				n, err := strconv.ParseUint(p.s[p.i:p.i+4], 16, 16)
				if err != nil {
					p.fail()
				}
				units = append(units, uint16(n))
				p.i += 4
			default:
				p.fail()
			}
		default:
			r, size := utf8.DecodeRuneInString(p.s[p.i:])
			units = append(units, utf16.Encode([]rune{r})...)
			p.i += size
		}
	}
}

// Stringify is JSON.stringify(v, null, 2).
func Stringify(v *Value) string {
	var b strings.Builder
	writeJSON(&b, v, "")
	return b.String()
}

func writeJSON(b *strings.Builder, v *Value, indent string) {
	switch v.Kind {
	case 'n':
		b.WriteString("null")
	case 'b':
		if v.Bool {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case 'f':
		b.WriteString(NumberToString(v.Num))
	case 's':
		writeJSONString(b, v.Str)
	case 'a':
		if len(v.Arr) == 0 {
			b.WriteString("[]")
			return
		}
		in := indent + "  "
		b.WriteString("[\n")
		for i, x := range v.Arr {
			if i > 0 {
				b.WriteString(",\n")
			}
			b.WriteString(in)
			writeJSON(b, x, in)
		}
		b.WriteString("\n" + indent + "]")
	case 'o':
		keys := v.keyOrder()
		if len(keys) == 0 {
			b.WriteString("{}")
			return
		}
		in := indent + "  "
		b.WriteString("{\n")
		for i, k := range keys {
			if i > 0 {
				b.WriteString(",\n")
			}
			b.WriteString(in)
			writeJSONString(b, k)
			b.WriteString(": ")
			writeJSON(b, v.Props[k], in)
		}
		b.WriteString("\n" + indent + "}")
	}
}

func writeJSONString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				b.WriteString(`\u00`)
				b.WriteByte("0123456789abcdef"[r>>4])
				b.WriteByte("0123456789abcdef"[r&15])
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}

// NumberToString is JavaScript's Number::toString for finite numbers (JSON writes null otherwise).
func NumberToString(f float64) string {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return "null"
	}
	if f == 0 {
		return "0"
	}
	neg := f < 0
	if neg {
		f = -f
	}
	// shortest digits and exponent: f = 0.d1d2… × 10^n
	e := strconv.FormatFloat(f, 'e', -1, 64) // d.ddddde±x
	mant, exp, _ := strings.Cut(e, "e")
	digits := strings.Replace(mant, ".", "", 1)
	x, _ := strconv.Atoi(exp)
	n := x + 1
	k := len(digits)
	var s string
	switch {
	case k <= n && n <= 21:
		s = digits + strings.Repeat("0", n-k)
	case 0 < n && n <= 21:
		s = digits[:n] + "." + digits[n:]
	case -6 < n && n <= 0:
		s = "0." + strings.Repeat("0", -n) + digits
	default:
		sign := "+"
		if n-1 < 0 {
			sign = "-"
		}
		ex := strconv.Itoa(abs(n - 1))
		if k == 1 {
			s = digits + "e" + sign + ex
		} else {
			s = digits[:1] + "." + digits[1:] + "e" + sign + ex
		}
	}
	if neg {
		return "-" + s
	}
	return s
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
