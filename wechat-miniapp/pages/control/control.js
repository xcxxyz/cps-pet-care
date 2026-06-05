const app = getApp();

Page({
  data: {
    ledBrightness: 0, brightnessPct: '0',
    lastFeed: '--', feedCount: 0, ledMode: 'auto'
  },

  onLoad() {
    this._update = () => {
      const s = app.globalData.latest;
      const led = s.led !== undefined ? s.led : 0;
      const mode = s.ledMode || 'auto';

      // 命令确认制：只接受匹配期望值的回执，5秒超时兜底
      if (this._pendingLed !== undefined) {
        if (Date.now() - this._pendingLedTime > 5000) {
          this._pendingLed = undefined; // 超时，放行
        } else if (led === this._pendingLed) {
          this._pendingLed = undefined; // 匹配，确认
        } else {
          return; // 旧数据，跳过
        }
      }
      if (this._pendingMode !== undefined) {
        if (Date.now() - this._pendingModeTime > 5000) {
          this._pendingMode = undefined;
        } else if (mode === this._pendingMode) {
          this._pendingMode = undefined;
        } else {
          return;
        }
      }

      this.setData({
        ledBrightness: led,
        brightnessPct: Math.round(led / 255 * 100).toString(),
        ledMode: mode
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
      this._pendingMode = 'manual'; this._pendingModeTime = Date.now();
    }
    this._pendingLed = v; this._pendingLedTime = Date.now();
    app.sendCommand({ type: 'led', value: v });
  },

  toggleAuto() {
    if (this.data.ledMode === 'auto') return;
    this._pendingMode = 'auto'; this._pendingModeTime = Date.now();
    this._pendingLed = undefined;
    app.sendCommand({ type: 'ledMode', value: 'auto' });
    this.setData({ ledMode: 'auto' });
  },

  setLed(e) {
    const v = parseInt(e.currentTarget.dataset.val);
    this._pendingLed = v; this._pendingLedTime = Date.now();
    this._pendingMode = 'manual'; this._pendingModeTime = Date.now();
    this.setData({ ledBrightness: v, brightnessPct: Math.round(v / 255 * 100).toString(), ledMode: 'manual' });
    app.sendCommand({ type: 'led', value: v });
  },

  onFeed() {
    const now = new Date().toTimeString().slice(0, 5);
    this.setData({ lastFeed: now, feedCount: this.data.feedCount + 1 });
    app.sendCommand({ type: 'feed', value: 1 });
    wx.showToast({ title: '喂食指令已发送', icon: 'success' });
  }
});
