"""读取 Wokwi RFC2217 串口，转发到 Bridge HTTP API"""
import serial, urllib.request, json, time, re

PORT = 'rfc2217://localhost:4000'
BRIDGE = 'http://localhost:3000/api/data'

while True:
    try:
        ser = serial.serial_for_url(PORT, baudrate=115200, timeout=10)
        print('Connected to Wokwi')
        buf = ''
        while True:
            ch = ser.read(1)
            if not ch:
                buf = ''
                continue
            buf += ch.decode('utf-8', errors='replace')
            if '\n' in buf:
                line, buf = buf.split('\n', 1)
                line = line.strip()
                if not line:
                    continue
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
    except Exception as e:
        print(f'Error: {e}, retry 3s...')
        time.sleep(3)
        try: ser.close()
        except: pass
