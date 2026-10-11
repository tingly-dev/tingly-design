/**
 * Splits a model's streaming reply into runnable statements.
 *
 * A statement ends at a newline outside any bracket, string or template
 * literal, so a reply can run line by line while it is still being written.
 * Code fences and comment lines are dropped.
 */
export class StatementSplitter {
  private buf = '';
  private depth = 0;
  /** stack of open string delimiters; '`' may contain '${' code which pushes '}' */
  private stack: string[] = [];
  private escaped = false;
  /** inside a markdown fence line (```js) that should be ignored */
  private skipLine = false;

  push(chunk: string): string[] {
    const out: string[] = [];
    for (const c of chunk) {
      if (this.skipLine) {
        if (c === '\n') this.skipLine = false;
        continue;
      }
      if (c === '`' && this.depth === 0 && this.stack.length === 0 && this.buf.trim() === '') {
        // a statement never starts with a backtick: this is a code fence
        this.skipLine = true;
        this.buf = '';
        continue;
      }
      this.buf += c;
      const top = this.stack[this.stack.length - 1];
      if (this.escaped) {
        this.escaped = false;
        continue;
      }
      if (top === '"' || top === "'" || top === '`') {
        if (c === '\\') this.escaped = true;
        else if (c === top) this.stack.pop();
        else if (top === '`' && c === '{' && this.buf.endsWith('${')) this.stack.push('${');
        else if ((top === '"' || top === "'") && c === '\n') this.stack.pop(); // unterminated, give up on it
        continue;
      }
      if (c === '"' || c === "'" || c === '`') this.stack.push(c);
      else if (c === '(' || c === '[' || c === '{') {
        if (top === '${') this.stack.push('{');
        else this.depth++;
      } else if (c === ')' || c === ']' || c === '}') {
        if (top === '${' && c === '}') this.stack.pop();
        else if (top === '{' && c === '}') this.stack.pop();
        else this.depth = Math.max(0, this.depth - 1);
      } else if (c === '\n' && this.depth === 0 && this.stack.length === 0) {
        const s = this.take();
        if (s) out.push(s);
      }
    }
    return out;
  }

  flush(): string[] {
    const s = this.take();
    this.depth = 0;
    this.stack = [];
    return s ? [s] : [];
  }

  private take(): string | null {
    const s = this.buf.trim();
    this.buf = '';
    if (!s || s.startsWith('```') || s.startsWith('//')) return null;
    return s;
  }
}

export function splitStatements(text: string): string[] {
  const sp = new StatementSplitter();
  return [...sp.push(text + '\n'), ...sp.flush()];
}
