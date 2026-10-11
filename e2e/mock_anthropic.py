"""Minimal Messages API mock: streams a scripted jQuery reply in small chunks."""
import json, re, time, sys, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LOG = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'mock.log')
os.makedirs(os.path.dirname(LOG), exist_ok=True)
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['content-length'])))
        msgs = body['messages']
        first = msgs[0]['content']
        open(LOG, 'a').write(json.dumps({'n': len(msgs), 'last': msgs[-1]['content'][:400], 'system': body.get('system', '')[:60]}) + '\n')
        m = re.search(r"pointed at\n(#\w+)", first)
        h = m.group(1) if m else '#dc2'
        if 'slide subset' in msgs[-1]['content']:
            # told that the reply broke the slide subset: answer inside it
            reply = (f"$('{h}').css('color', '#7c3aed')\n"
                     f"$('{h}').after(`<ul style=\"font-size: 28px; color: #4a5263\"></ul>`)\n"
                     f"$('{h}').next().append(`<li></li>`)\n"
                     f"$('{h}').next().children().first().repeat(3)\n"
                     f".text((i) => ['同步到所有 Agent', '保留每个 Agent 的覆盖', '改动写入 journal'][i])\n")
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
ThreadingHTTPServer(('127.0.0.1', 8790), H).serve_forever()
