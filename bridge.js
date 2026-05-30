const mqtt = require('mqtt');
const WebSocket = require('ws');
const http = require('http');

// ===================== 配置 =====================
const CONFIG = {
  hwCloud: {
    host: '49263b4a1c.st1.iotda-device.cn-north-4.myhuaweicloud.com',
    port: 8883,
    deviceId: '69fc054c7f2e6c302f6e5dfd_bridge_0',
    deviceSecret: 'ff45aa47900b0633688c80b34cd7a922b62c7e7cebab4340042e09b3292cabb5',
  },
  web: { port: 3000 },
};

// ===================== 全局状态 =====================
let latest = {
  temperature: 25, humidity: 60, light: 500, led: 128,
  heartrate: 80, activity: 0, feeding: 0
};
let clients = new Set();

// ===================== 华为云 MQTT =====================
function mqttPassword() {
  return 'a311fcd11dd3e12f0b733b013e2694fbbc346a471ee542de8d6aee1bafc01e1d';
}

console.log('连接华为云 IoTDA...');
const mqttClient = mqtt.connect({
  host: CONFIG.hwCloud.host, port: CONFIG.hwCloud.port,
  protocol: 'mqtts', rejectUnauthorized: false,
  clientId: `${CONFIG.hwCloud.deviceId}_0_0_${Date.now()}`,
  username: CONFIG.hwCloud.deviceId, password: mqttPassword(),
  clean: true, reconnectPeriod: 5000,
});

mqttClient.on('connect', () => {
  console.log('华为云 IoTDA 连接成功');
});

function reportToCloud(data) {
  const topic = `$oc/devices/${CONFIG.hwCloud.deviceId}/sys/properties/report`;
  mqttClient.publish(topic, JSON.stringify({
    services: [{ service_id: 'pet', properties: data }]
  }), { qos: 1 });
}

// ===================== HTTP API + WebSocket =====================
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/data') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        if (latest[d.type] !== undefined) {
          latest[d.type] = (d.type === 'feeding') ? parseInt(d.value) : parseFloat(d.value);
        }
        broadcast(d);
        console.log(`${d.type}:${d.value}`);
      } catch (e) { console.error(e.message); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', ...latest }));
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>CPS Pet Care Bridge</h1>');
});

const wss = new WebSocket.Server({ server });
wss.on('connection', ws => {
  console.log('WebSocket 客户端连接');
  clients.add(ws);
  for (const [k, v] of Object.entries(latest)) {
    ws.send(JSON.stringify({ type: k, value: v }));
  }
  ws.on('message', data => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'led') {
        latest.led = Math.min(255, Math.max(0, Number(msg.value)));
        broadcast({ type: 'led', value: latest.led });
      }
      if (msg.type === 'feed') {
        latest.feeding = 1;
        broadcast({ type: 'feeding', value: 1 });
        setTimeout(() => { latest.feeding = 0; broadcast({ type: 'feeding', value: 0 }); }, 2000);
      }
    } catch (e) { console.error(e.message); }
  });
  ws.on('close', () => clients.delete(ws));
});

server.listen(CONFIG.web.port, () => {
  console.log(`Bridge 已启动: http://localhost:${CONFIG.web.port}`);
});

function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(s);
}

// ===================== 模拟模式 (演示用) =====================
console.log('模拟模式: 生成 Wokwi 相同格式数据');
const t = { temp: 25, hum: 60 };
setInterval(() => {
  t.temp += (Math.random() - 0.5) * 0.3;
  t.temp = Math.round(Math.max(15, Math.min(40, t.temp)));
  t.hum += (Math.random() - 0.5) * 0.5;
  t.hum = Math.round(Math.max(30, Math.min(90, t.hum)));
  const light = Math.round(300 + Math.random() * 600);
  const led = light < 1000 ? Math.round((1000 - light) / 1000 * 255) : 0;
  const hr = 80 + Math.round(Math.random() * 12 - 5);
  const act = latest.activity + (Math.random() > 0.7 ? 1 : 0);

  latest = { temperature: t.temp, humidity: t.hum, light, led, heartrate: hr, activity: act, feeding: latest.feeding };
  for (const [k, v] of Object.entries(latest)) {
    broadcast({ type: k, value: v });
  }
  console.log(`T:${t.temp} H:${t.hum} L:${light} LED:${led} HR:${hr} ACT:${act}`);
}, 3000);
