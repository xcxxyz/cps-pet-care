const { MQTTClient } = require('./utils/mqtt.js');
const { genIoTDAPassword } = require('./utils/hmac-sha256.js');

const IOTDA = {
  host: '49263b4a1c.st1.iotda-device.cn-north-4.myhuaweicloud.com',
  deviceId: '69fc054c7f2e6c302f6e5dfd_led0',
  secret: 'xcxxyz123456',
};
const WSS_URL = `wss://${IOTDA.host}/mqtt`;
// bridge WebSocket 地址（开发环境）
const BRIDGE_URL = 'ws://192.168.143.127:3000';

function getTs() {
  const d = new Date();
  return d.getUTCFullYear().toString() +
    ('0' + (d.getUTCMonth() + 1)).slice(-2) +
    ('0' + d.getUTCDate()).slice(-2) +
    ('0' + d.getUTCHours()).slice(-2);
}

function getPassword() {
  return genIoTDAPassword(IOTDA.secret, getTs());
}

App({
  globalData: {
    connected: false,
    latest: { temperature: 0, humidity: 0, light: 0, led: 0, heartrate: 80, activity: 0, fanOn: 0, fanSpeed: 0, tempHigh: 28, humHigh: 75 },
    listeners: [],
    mqtt: null,
    ws: null,
    useBridge: false
  },

  onLaunch() {
    this.connectIoTDA(); // 优先连华为云
  },

  // ===== 华为云 IoTDA WSS =====
  connectIoTDA() {
    const ts = getTs();
    const clientId = `${IOTDA.deviceId}_0_1_${ts}`;
    const password = getPassword();
    console.log('[IoTDA] trying', WSS_URL);

    this._iotdaTimer = setTimeout(() => {
      console.log('[IoTDA] timeout, fallback to bridge');
      this.connectBridge();
    }, 15000);

    const mqtt = new MQTTClient({
      url: WSS_URL,
      clientId: clientId,
      username: IOTDA.deviceId,
      password: password,
      keepalive: 60
    });

    mqtt.on('onConnect', () => {
      clearTimeout(this._iotdaTimer);
      console.log('[IoTDA] connected');
      this.globalData.connected = true;
      this.globalData.mqtt = mqtt;
      this.globalData.useBridge = false;
      mqtt.subscribe('sys/messages/down');
    });

    mqtt.on('onClose', () => {
      console.log('[IoTDA] disconnected, retry...');
      this.globalData.connected = false;
      this.globalData.mqtt = null;
      setTimeout(() => this.connectBridge(), 2000);
    });

    mqtt.onMessage = (topic, msg) => {
      this._parseAndNotify(msg);
    };

    mqtt.connect();
  },

  // ===== Bridge WebSocket（fallback） =====
  connectBridge() {
    if (this.globalData.ws) {
      try { this.globalData.ws.close(); } catch (e) {}
    }
    console.log('[Bridge] connecting', BRIDGE_URL);
    const ws = wx.connectSocket({ url: BRIDGE_URL });
    this.globalData.ws = ws;

    ws.onOpen(() => {
      console.log('[Bridge] connected');
      this.globalData.connected = true;
      this.globalData.useBridge = true;
    });

    ws.onMessage((res) => {
      try {
        const msg = JSON.parse(res.data);
        if (msg.type && msg.value !== undefined) {
          this.globalData.latest[msg.type] = msg.value;
          this.notifyAll({ [msg.type]: msg.value });
        }
      } catch (e) {}
    });

    ws.onClose(() => {
      console.log('[Bridge] disconnected');
      this.globalData.connected = false;
      this.globalData.ws = null;
      setTimeout(() => this.connectIoTDA(), 3000); // 尝试切回华为云
    });

    ws.onError(() => {
      console.log('[Bridge] error');
    });
  },

  _parseAndNotify(msg) {
    try {
      const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
      let props = data;
      if (data.services && data.services[0] && data.services[0].properties) {
        props = data.services[0].properties;
      }
      for (const [k, v] of Object.entries(props)) {
        this.globalData.latest[k] = v;
      }
      this.notifyAll(props);
    } catch (e) {
      console.error('[MQTT] parse:', e);
    }
  },

  sendCommand(cmd) {
    if (this.globalData.useBridge) {
      // Bridge WebSocket 方式
      const ws = this.globalData.ws;
      if (!ws) return;
      if (cmd.type === 'led') ws.send({ data: JSON.stringify({ type: 'led', value: cmd.value }) });
      if (cmd.type === 'feed') ws.send({ data: JSON.stringify({ type: 'feed' }) });
      if (cmd.type === 'ledMode') ws.send({ data: JSON.stringify({ type: 'ledMode', value: cmd.value }) });
      if (cmd.tempHigh !== undefined) ws.send({ data: JSON.stringify({ type: 'tempHigh', value: cmd.tempHigh }) });
      if (cmd.humHigh !== undefined) ws.send({ data: JSON.stringify({ type: 'humHigh', value: cmd.humHigh }) });
      if (cmd.feedTimes !== undefined) ws.send({ data: JSON.stringify({ type: 'feedTimes', value: cmd.feedTimes }) });
      if (cmd.hrLow !== undefined) ws.send({ data: JSON.stringify({ type: 'hrLow', value: cmd.hrLow }) });
      if (cmd.hrHigh !== undefined) ws.send({ data: JSON.stringify({ type: 'hrHigh', value: cmd.hrHigh }) });
    } else {
      // IoTDA MQTT 方式
      const props = {};
      if (cmd.type === 'led') props.led = cmd.value;
      if (cmd.type === 'feed') props.feed = cmd.value;
      if (cmd.type === 'ledMode') props.ledMode = cmd.value;
      if (cmd.tempHigh !== undefined) props.tempHigh = cmd.tempHigh;
      if (cmd.humHigh !== undefined) props.humHigh = cmd.humHigh;
      if (cmd.hrLow !== undefined) props.hrLow = cmd.hrLow;
      if (cmd.hrHigh !== undefined) props.hrHigh = cmd.hrHigh;
      if (cmd.feedTimes !== undefined) props.feedTimes = cmd.feedTimes;
      const payload = JSON.stringify({ services: [{ service_id: 'pet', properties: props }] });
      const topic = `$oc/devices/${IOTDA.deviceId}/sys/messages/up`;
      if (this.globalData.mqtt) {
        this.globalData.mqtt.publish(topic, payload);
      }
    }
  },

  subscribe(fn) { this.globalData.listeners.push(fn); },
  unsubscribe(fn) { this.globalData.listeners = this.globalData.listeners.filter(f => f !== fn); },

  notifyAll(props) {
    this.globalData.listeners.forEach(fn => {
      try { fn(props, this.globalData); } catch (e) {}
    });
  }
});
