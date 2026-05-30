const app = getApp();

Page({
  data: { ledBrightness: 0, brightnessPct: '0', lastFeed: '--', feedCount: 0 },

  onLoad() {
    this._onData = this._onData.bind(this);
    app.subscribe(this._onData);
  },
  onUnload() { app.unsubscribe(this._onData); },

  _onData(_, g) {
    const v = g.latest.led || 0;
    this.setData({ ledBrightness: v, brightnessPct: Math.round(v / 255 * 100).toString() });
  },

  onSlider(e) {
    const v = parseInt(e.detail.value);
    this.setData({ ledBrightness: v, brightnessPct: Math.round(v / 255 * 100).toString() });
    app.sendCommand({ type: 'led', value: v });
  },

  setLed(e) {
    const v = parseInt(e.currentTarget.dataset.val);
    this.setData({ ledBrightness: v, brightnessPct: Math.round(v / 255 * 100).toString() });
    app.sendCommand({ type: 'led', value: v });
  },

  onFeed() {
    const now = new Date().toTimeString().slice(0, 5);
    this.setData({ lastFeed: now, feedCount: this.data.feedCount + 1 });
    app.sendCommand({ type: 'feed', value: 1 });
    wx.showToast({ title: '喂食指令已发送', icon: 'success' });
  }
});
