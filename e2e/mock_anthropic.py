"""Minimal Messages API mock: streams a scripted jQuery reply in small chunks.
python3 e2e/mock_anthropic.py [log] [port]  (port 8790 by default)"""
import json, re, time, sys, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LOG = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'mock.log')
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8790
def text_of(content):
    """A message's words: the string, or its text blocks joined (attachments ride along as other blocks)."""
    return content if isinstance(content, str) else '\n'.join(b.get('text', '') for b in content if b.get('type') == 'text')
def blocks_of(content):
    """What an attachment-carrying message holds, for the test to check: type, media type, a peek at the data."""
    if isinstance(content, str): return []
    return [{'type': b['type'], 'media_type': b.get('source', {}).get('media_type'), 'bytes': len(b.get('source', {}).get('data', '')), 'title': b.get('title'), 'text': b.get('text', '')[:300], 'tail': b.get('text', '')[-800:]} for b in content]
os.makedirs(os.path.dirname(LOG), exist_ok=True)
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['content-length'])))
        msgs = body['messages']
        first = text_of(msgs[0]['content'])
        open(LOG, 'a').write(json.dumps({'n': len(msgs), 'last': text_of(msgs[-1]['content'])[:400], 'system': body.get('system', '')[:60], 'blocks': blocks_of(msgs[0]['content'])}) + '\n')
        m = re.search(r"pointed at\n(#\w+)", first)
        h = m.group(1) if m else '#dc2'
        if body.get('system', '').startswith('You rewrite one passage'):
            # a doc's writing model: the passage back, marked, so the test can see it replaced
            m = re.search(r"<passage>\n([\s\S]*?)\n</passage>", first)
            reply = (m.group(1).strip() if m else '') + '（已改写）'
        elif 'slide subset' in text_of(msgs[-1]['content']):
            # told that the reply broke the slide subset: answer inside it
            reply = (f"$('{h}').css('color', '#7c3aed')\n"
                     f"$('{h}').after(`<ul style=\"font-size: 28px; color: #4a5263\"></ul>`)\n"
                     f"$('{h}').next().append(`<li></li>`)\n"
                     f"$('{h}').next().children().first().repeat(3)\n"
                     f".text((i) => ['同步到所有 Agent', '保留每个 Agent 的覆盖', '改动写入 journal'][i])\n")
        elif re.search('复制到另一块画板|onto the other artboard', first.rsplit('\nprompt\n', 1)[-1]):
            # a part copied onto another artboard; the first try writes the other artboard's handle without naming it and is refused
            other = re.search(r"- (\S+\.dc\.html): ", first).group(1)
            reply = (f"$('#b1_dc1').text('x')\n" if len(msgs) == 1 else f"$('{h}').css('color', '#0e7490')\n$('{h}').clone().appendTo(board('{other}'))\n")
        elif len(msgs) == 1:
            # first try: one good line, then a line that throws -> the editor must undo and retry
            reply = f"$('{h}').css('color', '#b42318')\n$('{h}').nope()\n"
        else:
            reply = (f"$('{h}').css({{'color': '#7c3aed', 'letter-spacing': '-0.01em'}})\n"
                     f"$('{h}').after(`<ul style=\"margin: 0 0 8px; padding-left: 18px; color: #4a5263\"></ul>`)\n"
                     f"$('{h}').next().append(`<li style=\"font-size: 14px\"></li>`)\n"
                     f"$('{h}').next().children().first().repeat(3)\n"
                     f".text((i) => ['同步到所有 Agent', '保留每个 Agent 的覆盖', '改动写入 journal'][i])\n")
        self.send_response(200)
        self.send_header('content-type', 'text/event-stream')
        self.end_headers()
        def ev(name, data):
            self.wfile.write(f"event: {name}\ndata: {json.dumps(data)}\n\n".encode()); self.wfile.flush()
        ev('message_start', {'type': 'message_start', 'message': {'id': 'msg_mock', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'content': [], 'stop_reason': None, 'stop_sequence': None, 'usage': {'input_tokens': 10, 'output_tokens': 1}}})
        ev('content_block_start', {'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}})
        for i in range(0, len(reply), 7):
            ev('content_block_delta', {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': reply[i:i+7]}})
            time.sleep(0.02)
        ev('content_block_stop', {'type': 'content_block_stop', 'index': 0})
        ev('message_delta', {'type': 'message_delta', 'delta': {'stop_reason': 'end_turn', 'stop_sequence': None}, 'usage': {'output_tokens': 50}})
        ev('message_stop', {'type': 'message_stop'})
ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
