const app = getApp();

Page({
  data: {
    tempHigh: 28, humHigh: 75, lightLow: 300,
    hrLow: 60, hrHigh: 110,
    feedTimes: ['08:00', '20:00']
  },

  onLoad() {
    const gl = app.globalData.latest;
    ['tempHigh','humHigh','hrLow','hrHigh'].forEach(k => {
      if (gl[k]) this.setData({ [k]: gl[k] });
    });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: parseInt(e.detail.value) || 0 });
  },

  saveEnv() {
    const { tempHigh, humHigh } = this.data;
    app.sendCommand({ tempHigh, humHigh });
    wx.showToast({ title: '环境阈值已保存', icon: 'success' });
  },

  saveHr() {
    const { hrLow, hrHigh } = this.data;
    app.sendCommand({ hrLow, hrHigh });
    wx.showToast({ title: '心率阈值已保存', icon: 'success' });
  },

  onTimeChange(e) {
    const idx = e.currentTarget.dataset.index;
    const val = e.detail.value;
    const times = [...this.data.feedTimes];
    times[idx] = val;
    this.setData({ feedTimes: times });
  },

  onAddFeedTime(e) {
    const time = e.detail.value;
    if (this.data.feedTimes.length >= 4) return;
    const times = [...this.data.feedTimes, time];
    this.setData({ feedTimes: times });
    app.sendCommand({ feedTimes: times });
  },

  deleteFeedTime(e) {
    const idx = e.currentTarget.dataset.index;
    const times = [...this.data.feedTimes];
    times.splice(idx, 1);
    this.setData({ feedTimes: times });
    app.sendCommand({ feedTimes: times });
  },

  saveFeedTimes() {
    app.sendCommand({ feedTimes: this.data.feedTimes });
    wx.showToast({ title: '喂食计划已更新', icon: 'success' });
  }
});
