App({
  globalData: {
    connected: false,
    latest: { temperature: 0, humidity: 0, light: 0, led: 0, heartrate: 80, activity: 0, fanOn: 0, fanSpeed: 0, tempHigh: 28, humHigh: 75 },
    listeners: [],
    socketTask: null
  },

  onLaunch() {
    this.connect();
  },

  connect() {
    console.log('[WS] connecting to 127.0.0.1:3000');
    const ws = wx.connectSocket({
      url: 'ws://127.0.0.1:3000',
      header: { 'content-type': 'application/json' },
    });
    this.globalData.socketTask = ws;

    ws.onOpen(() => {
      console.log('[WS] connected');
      this.globalData.connected = true;
      this.notify();
    });

    ws.onError((err) => {
      console.error('[WS] error:', JSON.stringify(err));
    });

    ws.onClose((res) => {
      console.log('[WS] closed, code:', res.code, 'reason:', res.reason);
      this.globalData.connected = false;
      this.notify();
      setTimeout(() => this.connect(), 3000);
    });

    ws.onMessage((res) => {
      try {
        const d = JSON.parse(res.data);
        if (d.type === 'feedSchedule') {
          this.globalData.feedSchedule = d.value;
        } else if (d.type !== undefined) {
          this.globalData.latest[d.type] = d.value;
        }
        this.notify(d);
      } catch (e) {
        console.error('[WS] parse error:', e);
      }
    });
  },

  subscribe(fn) { this.globalData.listeners.push(fn); },
  unsubscribe(fn) { this.globalData.listeners = this.globalData.listeners.filter(f => f !== fn); },
  notify(data) { this.globalData.listeners.forEach(f => f(data, this.globalData)); },

  sendCommand(cmd) {
    const ws = this.globalData.socketTask;
    if (ws) ws.send({ data: JSON.stringify(cmd) });
  }
});
