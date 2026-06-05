"""Wokwi RFC2217 单连接双向桥接——同连接读写互不干扰"""
import serial, urllib.request, json, time, re, threading, queue, os
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 'rfc2217://localhost:4000'
BRIDGE = 'http://localhost:3000/api/data'
CMD_PORT = 3001
cmd_queue = queue.Queue()

class CmdHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length > 0 else {}
        cmd_queue.put(body.get('cmd', ''))
        self.send_response(200); self.end_headers()
    def log_message(self, *args): pass

threading.Thread(target=lambda: HTTPServer(('127.0.0.1', CMD_PORT), CmdHandler).serve_forever(), daemon=True).start()

os.makedirs('D:/temp', exist_ok=True)
with open('D:/temp/wokwi-bridge.pid', 'w') as f:
    f.write(str(os.getpid()))

while True:
    try:
        ser = serial.serial_for_url(PORT, baudrate=115200, timeout=0.3)
        print(f'PID={os.getpid()} Connected')
        buf = ''
        while True:
            # 读串口
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
                                    headers={'Content-Type': 'application/json'}), timeout=2)
                            except: pass
                        elif 'FEED' in line:
                            val = 1 if 'FEED:1' in line else 0
                            try:
                                urllib.request.urlopen(urllib.request.Request(
                                    BRIDGE, data=json.dumps({'feeding': val}).encode(),
                                    headers={'Content-Type': 'application/json'}), timeout=2)
                            except: pass

            # 同连接写命令
            try:
                cmd = cmd_queue.get_nowait()
                ser.write((cmd + '\r\n').encode())
                ser.flush()
                print(f'CMD: {cmd}')
            except queue.Empty:
                pass
    except Exception as e:
        print(f'Error: {e}, retry 2s...')
        time.sleep(2)
        try: ser.close()
        except: pass
