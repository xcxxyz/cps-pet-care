// 轻量 MQTT-over-WebSocket 客户端，适配微信小程序 + 华为云 IoTDA

const STATE = { DISCONNECTED: 0, CONNECTING: 1, CONNECTED: 2 };

function encodeUTF8(s) {
  const buf = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) buf.push(c);
    else if (c < 0x800) { buf.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else { buf.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  return buf;
}

function packUTF8(s) {
  const b = encodeUTF8(s);
  return [(b.length >> 8) & 0xff, b.length & 0xff, ...b];
}

function buildPacket(type, flags, payload) {
  const header = [(type << 4) | flags];
  let len = payload.length;
  const rl = [];
  do { rl.unshift(len & 0x7f | (len > 127 ? 0x80 : 0)); len >>= 7; } while (len);
  return new Uint8Array([...header, ...rl, ...payload]).buffer;
}

function parsePacket(buf) {
  if (buf.byteLength < 2) return null;
  const b = new Uint8Array(buf);
  let pos = 1, mul = 1, rl = 0;
  do { rl += (b[pos] & 127) * mul; mul *= 128; } while (b[pos++] & 128);
  if (buf.byteLength < pos + rl) return null;
  return {
    type: (b[0] >> 4) & 15,
    payload: buf.slice(pos, pos + rl),
    consumed: pos + rl
  };
}

class MQTTClient {
  constructor(opts) {
    this.url = opts.url;
    this.clientId = opts.clientId;
    this.username = opts.username;
    this.password = opts.password;
    this.keepalive = opts.keepalive || 60;
    this.state = STATE.DISCONNECTED;
    this.onMessage = null;
    this._buf = new ArrayBuffer(0);
    this._timer = null;
    this._callbacks = {};
  }

  connect() {
    if (this.state !== STATE.DISCONNECTED) return;
    this.state = STATE.CONNECTING;
    this._task = wx.connectSocket({ url: this.url, tcpNoDelay: true });
    this._task.onOpen(() => this._sendConnect());
    this._task.onMessage(res => this._handle(res.data));
    this._task.onClose(() => { this._stop(); if (this._callbacks.onClose) this._callbacks.onClose(); });
    this._task.onError(() => { this._stop(); if (this._callbacks.onClose) this._callbacks.onClose(); });
  }

  _sendConnect() {
    const cid = packUTF8(this.clientId);
    const user = this.username ? packUTF8(this.username) : [0, 0];
    const pass = this.password ? packUTF8(this.password) : [0, 0];
    const keepAlive = [(this.keepalive >> 8) & 0xff, this.keepalive & 0xff];
    // protocol name: "MQTT"
    const proto = [0, 4, 77, 81, 84, 84]; // MQTT
    const flags = [2 | (this.username ? 0x80 : 0) | (this.password ? 0x40 : 0)];
    const payload = [...proto, 4, ...flags, ...keepAlive, ...cid, ...user, ...pass];
    this._send(1, 0, payload);
  }

  subscribe(topic, qos = 1) {
    const pid = [0, 1];
    const t = packUTF8(topic);
    const q = [qos];
    this._send(8, 2, [...pid, ...t, ...q]);
  }

  publish(topic, payload) {
    const t = packUTF8(topic);
    const data = typeof payload === 'string' ? encodeUTF8(payload) : payload;
    this._send(3, 0, [...t, ...data]);
  }

  _send(type, flags, payload) {
    if (this.state !== STATE.CONNECTED && type !== 1) return;
    this._task.send({ data: buildPacket(type, flags, payload) });
  }

  _handle(data) {
    // Merge buffers
    const incoming = new Uint8Array(data);
    const existing = new Uint8Array(this._buf);
    const merged = new Uint8Array(existing.length + incoming.length);
    merged.set(existing); merged.set(incoming, existing.length);
    this._buf = merged.buffer;

    while (true) {
      const pkt = parsePacket(this._buf);
      if (!pkt) break;
      this._buf = this._buf.slice(pkt.consumed);
      this._dispatch(pkt.type, pkt.payload);
    }
  }

  _dispatch(type, payload) {
    const b = new Uint8Array(payload);
    if (type === 2) { // CONNACK
      this.state = STATE.CONNECTED;
      this._heartbeat();
      if (this._callbacks.onConnect) this._callbacks.onConnect();
    } else if (type === 3 && this.onMessage) { // PUBLISH
      let pos = 0, len = (b[0] << 8) | b[1]; pos += 2;
      const topic = String.fromCharCode(...b.slice(pos, pos + len)); pos += len;
      // skip qos pid if present
      const qos = (b[0] & 6) >> 1;
      if (qos > 0) pos += 2;
      const msg = String.fromCharCode(...b.slice(pos));
      this.onMessage(topic, msg);
    }
  }

  _heartbeat() {
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => {
      if (this.state === STATE.CONNECTED) this._send(12, 0, []); // PINGREQ
    }, (this.keepalive - 5) * 1000);
  }

  _stop() {
    this.state = STATE.DISCONNECTED;
    if (this._timer) clearInterval(this._timer);
  }

  on(event, cb) { this._callbacks[event] = cb; }
  close() { this._stop(); if (this._task) this._task.close(); }
}

module.exports = { MQTTClient };
