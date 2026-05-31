const app = getApp();

Page({
  data: {
    ledBrightness: 0, brightnessPct: '0',
    lastFeed: '--', feedCount: 0,
    ledMode: 'auto', sliderChanging: false
  },

  onLoad() {
    this._onData = this._onData.bind(this);
    app.subscribe(this._onData);
  },
  onUnload() { app.unsubscribe(this._onData); },

  _onData(_, g) {
    const d = {};
    if (g.latest.led !== undefined) {
      d.ledBrightness = g.latest.led;
      d.brightnessPct = Math.round(g.latest.led / 255 * 100).toString();
    }
    if (g.latest.ledMode !== undefined) {
      d.ledMode = g.latest.ledMode;
    }
    this.setData(d);
  },

  // 滑块拖动
  onSliderChange(e) {
    const v = parseInt(e.detail.value);
    this.setData({ ledBrightness: v, brightnessPct: Math.round(v / 255 * 100).toString(), sliderChanging: true });
  },
  // 滑块松手 → 发指令
  onSliderDone(e) {
    const v = parseInt(e.detail.value);
    this.setData({ sliderChanging: false });
    app.sendCommand({ type: 'led', value: v });
  },

  setLed(e) {
    const v = parseInt(e.currentTarget.dataset.val);
    this.setData({ ledBrightness: v, brightnessPct: Math.round(v / 255 * 100).toString() });
    app.sendCommand({ type: 'led', value: v });
  },

  toggleAuto() {
    if (this.data.ledMode === 'auto') return;
    this.setData({ ledMode: 'auto' });
    app.sendCommand({ type: 'ledMode', value: 'auto' });
  },

  onFeed() {
    const now = new Date().toTimeString().slice(0, 5);
    this.setData({ lastFeed: now, feedCount: this.data.feedCount + 1 });
    app.sendCommand({ type: 'feed', value: 1 });
    wx.showToast({ title: '喂食指令已发送', icon: 'success' });
  }
});
