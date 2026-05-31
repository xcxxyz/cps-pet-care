const mqtt = require('mqtt');
const WebSocket = require('ws');
const http = require('http');
const { SerialPort } = require('serialport');

// 与 tinkercad-three-end/bridge.js 完全相同配置
const CONFIG = {
  hwCloud: {
    host: '49263b4a1c.st1.iotda-device.cn-north-4.myhuaweicloud.com',
    port: 8883,
    deviceId: '69fc054c7f2e6c302f6e5dfd_bridge_0',
  },
  web: { port: 3000 },
};

function generateMqttPassword() {
  return 'a311fcd11dd3e12f0b733b013e2694fbbc346a471ee542de8d6aee1bafc01e1d';
}

// ===================== 仿真状态 =====================
let state = {
  temperature: 25, humidity: 60, light: 500, led: 128,
  heartrate: 80, activity: 0, fanOn: 0, fanSpeed: 0,
  tempHigh: 28, humHigh: 75, ledMode: 'auto',
  vision_type: '', vision_behavior: ''
};
let feedSchedule = ['08:00', '20:00'];
let clients = new Set();

function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(s);
}

// ===================== 复用已验证的 MQTT 连接代码 =====================
console.log('正在连接华为云 IoTDA...');

function createMqttClient() {
  const pwd = generateMqttPassword();
  const client = mqtt.connect({
    host: CONFIG.hwCloud.host,
    port: CONFIG.hwCloud.port,
    protocol: 'mqtts',
    rejectUnauthorized: false,
    clientId: `69fc054c7f2e6c302f6e5dfd_bridge_0_0_0_2026052913`,
    username: CONFIG.hwCloud.deviceId,
    password: pwd,
    clean: true,
    reconnectPeriod: 5000,
  });

  client.on('connect', () => {
    console.log('✓ 华为云 IoTDA 连接成功');
    const setTopic = `$oc/devices/${CONFIG.hwCloud.deviceId}/sys/properties/set/#`;
    const reportTopic = `$oc/devices/${CONFIG.hwCloud.deviceId}/sys/properties/report`;
    client.subscribe(setTopic, { qos: 1 });
    console.log('✓ 已订阅控制指令');
    // 立即上报一次
    client.publish(reportTopic, JSON.stringify(buildReport()), { qos: 1 });
  });

  client.on('error', (err) => console.log('MQTT 错误:', err.message));
  client.on('close', () => console.log('MQTT 断开，自动重连中...'));

  client.on('message', (topic, payload) => {
    try {
      const msg = JSON.parse(payload.toString());
      const props = (msg.services && msg.services[0] && msg.services[0].properties) || msg;
      if (props.led !== undefined) {
        state.led = Math.min(255, Math.max(0, Number(props.led)));
        state.ledMode = 'manual';
        broadcast({ type: 'led', value: state.led });
        broadcast({ type: 'ledMode', value: 'manual' });
        console.log('手动调光 -> LED:', state.led);
      }
      if (props.ledMode === 'auto') {
        state.ledMode = 'auto';
        broadcast({ type: 'ledMode', value: 'auto' });
        console.log('切换自动调光');
      }
      if (props.tempHigh !== undefined) state.tempHigh = Number(props.tempHigh);
      if (props.humHigh !== undefined) state.humHigh = Number(props.humHigh);
      if (props.feed === 1) {
        broadcast({ type: 'feeding', value: 1 });
        console.log('远程喂食触发');
        setTimeout(() => broadcast({ type: 'feeding', value: 0 }), 2000);
      }
      if (props.feedTimes !== undefined) {
        feedSchedule = props.feedTimes;
        console.log('喂食计划更新:', feedSchedule);
      }
    } catch (e) {}
  });

  return client;
}

function buildReport() {
  return { services: [{ service_id: 'pet', properties: { ...state } }] };
}

let mqttClient = createMqttClient();

// ===================== 解析 Wokwi 串口数据 =====================
function parseWokwiLine(line) {
  const m = line.match(/T:(\d+)\s+H:(\d+)\s+L:(\d+)\s+LED:(\d+)\s+HR:(\d+)\s+ACT:(\d+)\s+FAN:(\d)/);
  if (m) {
    state.temperature = parseInt(m[1]);
    state.humidity = parseInt(m[2]);
    state.light = parseInt(m[3]);
    state.led = parseInt(m[4]);
    state.heartrate = parseInt(m[5]);
    state.activity = parseInt(m[6]);
    state.fanOn = parseInt(m[7]);
    state.fanSpeed = state.fanOn ? 255 : 0;
    return true;
  }
  if (line.includes('FEED:1')) { broadcast({ type: 'feeding', value: 1 }); }
  if (line.includes('FEED:0')) { broadcast({ type: 'feeding', value: 0 }); }
  return false;
}

// ===================== 连接 Wokwi TCP 串口 =====================
console.log('尝试连接 Wokwi 串口...');
let useSim = false;
const wokwiPort = new SerialPort({ path: 'rfc2217://localhost:4000', baudRate: 115200, autoOpen: false });

wokwiPort.on('data', (data) => {
  const lines = data.toString().split('\n');
  for (const line of lines) {
    if (parseWokwiLine(line.trim())) {
      // 广播真实 Wokwi 数据
      for (const [k, v] of Object.entries(state)) broadcast({ type: k, value: v });
      // MQTT 上报
      if (mqttClient && mqttClient.connected) {
        const topic = `$oc/devices/${CONFIG.hwCloud.deviceId}/sys/properties/report`;
        mqttClient.publish(topic, JSON.stringify(buildReport()), { qos: 1 });
      }
    }
  }
});

wokwiPort.on('open', () => console.log('✓ 已连接 Wokwi 串口，使用真实数据'));
wokwiPort.on('error', () => {
  console.log('⚠ Wokwi 未运行，使用仿真数据');
  useSim = true;
});
wokwiPort.on('close', () => { if (!useSim) console.log('Wokwi 串口断开'); });
wokwiPort.open();

// ===================== 传感器仿真（Wokwi 未连接时使用） =====================
setInterval(() => {
  // 始终运行仿真，Wokwi 数据通过 /api/data 覆盖
  const t = state.temperature + (Math.random() - 0.5) * 0.6;
  state.temperature = Math.round(Math.max(15, Math.min(40, t)));
  const h = state.humidity + (Math.random() - 0.5);
  state.humidity = Math.round(Math.max(30, Math.min(90, h)));
  state.light = Math.round(state.light + (Math.random() - 0.5) * 100);
  state.light = Math.max(200, Math.min(2000, state.light));
  if (state.ledMode === 'auto') {
    state.led = Math.round((1 - state.light / 4095) * 255);
  }

  if (state.temperature > state.tempHigh || state.humidity > state.humHigh) {
    state.fanOn = 1; state.fanSpeed = 255;
  } else if (state.temperature <= state.tempHigh - 1 && state.humidity <= state.humHigh - 3) {
    state.fanOn = 0; state.fanSpeed = 0;
  }
  state.heartrate = 80 + Math.round(Math.random() * 12 - 5);
  if (Math.random() > 0.7) state.activity++;

  // MQTT 上报
  if (mqttClient && mqttClient.connected) {
    const topic = `$oc/devices/${CONFIG.hwCloud.deviceId}/sys/properties/report`;
    mqttClient.publish(topic, JSON.stringify(buildReport()), { qos: 1 });
  }

  // WebSocket 广播
  for (const [k, v] of Object.entries(state)) broadcast({ type: k, value: v });

  console.log(`T:${state.temperature} H:${state.humidity} L:${state.light} LED:${state.led} HR:${state.heartrate} ACT:${state.activity} FAN:${state.fanOn}`);
}, 3000);

// ===================== 定时喂食 =====================
setInterval(() => {
  const n = new Date();
  const ts = `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
  if (feedSchedule.includes(ts)) {
    broadcast({ type: 'feeding', value: 1 });
    console.log('定时喂食:', ts);
    setTimeout(() => broadcast({ type: 'feeding', value: 0 }), 2000);
  }
}, 60000);

// ===================== HTTP + WebSocket =====================
const server = http.createServer((req, res) => {
  // POST /api/data — 接收 Wokwi 真实数据
  if (req.method === 'POST' && req.url === '/api/data') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        // 自动调光
        if (d.light !== undefined && state.ledMode === 'auto') {
          state.led = Math.round((1 - d.light / 4095) * 255);
          d.led = state.led;
        }
        for (const [k, v] of Object.entries(d)) {
          if (state[k] !== undefined) state[k] = v;
        }
        broadcast({ type: 'ledMode', value: state.ledMode });
        for (const [k, v] of Object.entries(d)) broadcast({ type: k, value: v });
        // MQTT 上报华为云
        if (mqttClient && mqttClient.connected) {
          const topic = `$oc/devices/${CONFIG.hwCloud.deviceId}/sys/properties/report`;
          mqttClient.publish(topic, JSON.stringify(buildReport()), { qos: 1 });
        }
        useSim = false; // 关闭仿真，使用真实数据
        console.log('Wokwi:', JSON.stringify(d));
      } catch (e) { console.error('API error:', e.message); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', ...state }));
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', ...state }));
});

const wss = new WebSocket.Server({ server });
wss.on('connection', (ws) => {
  console.log('✓ 小程序连接');
  clients.add(ws);
  setTimeout(() => {
    for (const [k, v] of Object.entries(state)) ws.send(JSON.stringify({ type: k, value: v }));
  }, 500);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'led') {
        state.led = Math.min(255, Math.max(0, Number(msg.value)));
        state.ledMode = 'manual';
        broadcast({ type: 'led', value: state.led });
        broadcast({ type: 'ledMode', value: 'manual' });
      }
      if (msg.type === 'ledMode' && msg.value === 'auto') {
        state.ledMode = 'auto';
        broadcast({ type: 'ledMode', value: 'auto' });
      }
      if (msg.type === 'feed') {
        broadcast({ type: 'feeding', value: 1 });
        setTimeout(() => broadcast({ type: 'feeding', value: 0 }), 2000);
      }
    } catch (e) {}
  });
  ws.on('close', () => clients.delete(ws));
});

server.listen(CONFIG.web.port, () => {
  console.log(`✓ WebSocket: ws://localhost:${CONFIG.web.port}`);
});
