const app = getApp();

Page({
  data: {
    ledBrightness: 0, brightnessPct: '0',
    lastFeed: '--', feedCount: 0, ledMode: 'auto'
  },
  timer: null,

  onLoad() { this.fetch(); this.timer = setInterval(() => this.fetch(), 3000); },
  onUnload() { clearInterval(this.timer); },

  fetch() {
    wx.request({
      url: 'http://127.0.0.1:3000/api/state',
      success: (res) => {
        const s = res.data;
        this.setData({
          ledBrightness: s.led || 0,
          brightnessPct: Math.round((s.led || 0) / 255 * 100).toString(),
          ledMode: s.ledMode || 'auto'
        });
      }
    });
  },

  onSliderChange(e) {
    const v = parseInt(e.detail.value);
    this.setData({ ledBrightness: v, brightnessPct: Math.round(v / 255 * 100).toString() });
    // 手动拖滑条 → 切手动模式
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
  }
});
