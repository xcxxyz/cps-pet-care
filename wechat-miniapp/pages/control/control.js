const app = getApp();

Page({
  data: {
    ledBrightness: 0, brightnessPct: '0',
    lastFeed: '--', feedCount: 0, ledMode: 'auto'
  },

  onLoad() {
    this._update = () => {
      const s = app.globalData.latest;
      this.setData({
        ledBrightness: s.led || 0,
        brightnessPct: Math.round((s.led || 0) / 255 * 100).toString(),
        ledMode: s.ledMode || 'auto'
      });
    };
    app.subscribe(this._update);
    this._update();
  },

  onUnload() { app.unsubscribe(this._update); },

  onSliderChange(e) {
    const v = parseInt(e.detail.value);
    this.setData({ ledBrightness: v, brightnessPct: Math.round(v / 255 * 100).toString() });
    if (this.data.ledMode === 'auto') {
      this.setData({ ledMode: 'manual' });
    }
    app.sendCommand({ type: 'led', value: v });
  },

  toggleAuto() {
    if (this.data.ledMode === 'auto') return;
    app.sendCommand({ type: 'ledMode', value: 'auto' });
    this.setData({ ledMode: 'auto' });
  },

  onFeed() {
    const now = new Date().toTimeString().slice(0, 5);
    this.setData({ lastFeed: now, feedCount: this.data.feedCount + 1 });
    app.sendCommand({ type: 'feed', value: 1 });
    wx.showToast({ title: '喂食指令已发送', icon: 'success' });
  },

  setLed(e) {
    const v = parseInt(e.currentTarget.dataset.val);
    this.setData({ ledBrightness: v, brightnessPct: Math.round(v / 255 * 100).toString(), ledMode: 'manual' });
    app.sendCommand({ type: 'led', value: v });
  }
});
