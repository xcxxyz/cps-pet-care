const app = getApp();

Page({
  data: {
    connected: false, temperature: '--', humidity: '--', heartRate: '--',
    activityCount: 0, nextFeed: '--', ledBrightness: 0, brightnessPct: '0',
    fanOn: false, fanSpeed: 0, updateTime: ''
  },

  onLoad() {
    this._onData = this._onData.bind(this);
    app.subscribe(this._onData);
  },
  onUnload() { app.unsubscribe(this._onData); },

  _onData(_, g) {
    const s = g.latest;
    this.setData({
      connected: g.connected,
      temperature: s.temperature || '--',
      humidity: s.humidity || '--',
      heartRate: s.heartrate || '--',
      activityCount: s.activity || 0,
      ledBrightness: s.led || 0,
      brightnessPct: Math.round((s.led || 0) / 255 * 100).toString(),
      fanOn: s.fanOn === 1 || s.fanOn === true,
      fanSpeed: s.fanSpeed || 0,
      updateTime: g.connected ? new Date().toLocaleTimeString() : '连接中...'
    });
  }
});
