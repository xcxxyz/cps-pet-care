"""Wokwi RFC2217 双向桥接 — 读数据→HTTP, 写命令从主线程(线程安全)"""
import serial, urllib.request, json, time, re, threading, queue
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 'rfc2217://localhost:4000'
BRIDGE = 'http://localhost:3000/api/data'
CMD_PORT = 3001
cmd_queue = queue.Queue()
ser = None

class CmdHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length > 0 else {}
        cmd_queue.put(body.get('cmd', ''))
        self.send_response(200); self.end_headers()
    def log_message(self, *args): pass

def serve(): HTTPServer(('127.0.0.1', CMD_PORT), CmdHandler).serve_forever()
threading.Thread(target=serve, daemon=True).start()

while True:
    try:
        ser = serial.serial_for_url(PORT, baudrate=115200, timeout=0.5)
        print('Connected to Wokwi')
        buf = ''
        while True:
            ch = ser.read(1)
            if ch:
                buf += ch.decode('utf-8', errors='replace')
                if '\n' in buf:
                    line, buf = buf.split('\n', 1)
                    line = line.strip()
                    if line:
                        m = re.match(r'T:([-\d]+)\s+H:([-\d]+)\s+L:(\d+)\s+LED:(\d+)\s+HR:(\d+)\s+ACT:(\d+)\s+FAN:(\d)', line)
                        if m:
                            data = {
                                'temperature': int(m.group(1)), 'humidity': int(m.group(2)),
                                'light': int(m.group(3)), 'led': int(m.group(4)),
                                'heartrate': int(m.group(5)), 'activity': int(m.group(6)),
                                'fanOn': int(m.group(7)), 'fanSpeed': 255 if int(m.group(7)) else 0
                            }
                            try:
                                urllib.request.urlopen(urllib.request.Request(
                                    BRIDGE, data=json.dumps(data).encode(),
                                    headers={'Content-Type': 'application/json'}
                                ), timeout=2)
                                print(f'Wokwi -> T:{data["temperature"]} H:{data["humidity"]} L:{data["light"]} ACT:{data["activity"]}')
                            except: pass
                        elif 'FEED' in line:
                            val = 1 if 'FEED:1' in line else 0
                            try:
                                urllib.request.urlopen(urllib.request.Request(
                                    BRIDGE, data=json.dumps({'feeding': val}).encode(),
                                    headers={'Content-Type': 'application/json'}
                                ), timeout=2)
                                print(f'Wokwi -> FEED:{val}')
                            except: pass
            # 主线程统一处理写入(线程安全)
            try:
                while True:
                    cmd = cmd_queue.get_nowait()
                    if ser and ser.is_open:
                        ser.write((cmd + '\n').encode())
                        print(f'  -> Serial: {cmd}')
            except queue.Empty:
                pass
    except Exception as e:
        print(f'Error: {e}, retry 3s...')
        time.sleep(3)
        try: ser.close()
        except: pass
