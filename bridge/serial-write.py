"""独立串口写入——每个命令开一个短暂连接"""
import serial, sys, time

PORT = 'rfc2217://localhost:4001'
cmd = sys.argv[1] if len(sys.argv) > 1 else ''
try:
    ser = serial.serial_for_url(PORT, baudrate=115200, timeout=1)
    ser.write((cmd + '\r\n').encode())
    ser.flush()
    time.sleep(1)  # 等 ESP32 处理完
    ser.close()
    print(f'WROTE: {cmd}')
except Exception as e:
    print(f'ERROR: {e}')
    sys.exit(1)
