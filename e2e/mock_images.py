"""Minimal OpenAI images API mock: /v1/images/generations answers with a base64 PNG, /v1/images/edits (multipart) with another.
Each request is logged as a JSON line (path, auth header, model, prompt, size) for the test to read.
python3 e2e/mock_images.py [log] [port]  (port 8791 by default)"""
import base64, json, os, re, struct, sys, zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LOG = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'mock-images.log')
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8791
os.makedirs(os.path.dirname(LOG), exist_ok=True)
def png(w, h, rgb_at):
    raw = b''.join(b'\x00' + b''.join(bytes(rgb_at(x, y, w, h)) for x in range(w)) for y in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
GENERATED = png(96, 64, lambda x, y, w, h: (40 + 180 * x // w, 90, 220 - 150 * y // h))
EDITED = png(96, 64, lambda x, y, w, h: (230 - 150 * y // h, 150 + 80 * x // w, 60))
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get('content-length', 0)))
        ctype = self.headers.get('content-type', '')
        entry = {'path': self.path, 'auth': self.headers.get('authorization'), 'type': ctype.split(';')[0]}
        if ctype.startswith('application/json'):
            entry.update({k: v for k, v in json.loads(raw).items() if k in ('model', 'prompt', 'size', 'quality', 'n')})
        else:
            text = raw.decode('latin-1')
            entry['fields'] = sorted(set(re.findall(r'name="(\w+)"', text)))
            m = re.search(r'name="prompt"\r\n\r\n(.*?)\r\n--', text, re.S)
            entry['prompt'] = m.group(1) if m else None
            m = re.search(r'name="model"\r\n\r\n(.*?)\r\n--', text, re.S)
            entry['model'] = m.group(1) if m else None
        open(LOG, 'a').write(json.dumps(entry) + '\n')
        if entry.get('prompt') == 'FAIL':
            self.send_response(400); self.send_header('content-type', 'application/json'); self.end_headers()
            self.wfile.write(json.dumps({'error': {'message': 'Your request was rejected by the safety system.'}}).encode()); return
        data = EDITED if self.path.endswith('/edits') else GENERATED
        self.send_response(200); self.send_header('content-type', 'application/json'); self.end_headers()
        self.wfile.write(json.dumps({'created': 1, 'data': [{'b64_json': base64.b64encode(data).decode()}]}).encode())
ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
