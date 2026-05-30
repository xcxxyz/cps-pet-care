const app = getApp();

Page({
  data: {
    heartRate: '--', hrHistory: [],
    activityToday: 0, perHour: '--',
    tempHistory: [], humHistory: [],
    hrSummary: { avg: '--', max: '--', min: '--' }
  },

  onLoad() {
    this._onData = this._onData.bind(this);
    this._count = 0;
    app.subscribe(this._onData);
  },
  onUnload() { app.unsubscribe(this._onData); },

  _onData(_, g) {
    const s = g.latest;
    this._count++;
    const d = { heartRate: s.heartrate || '--', activityToday: s.activity || 0 };

    // 心率历史
    const hr = [...this.data.hrHistory, { v: s.heartrate, t: new Date().toLocaleTimeString() }].slice(-10);
    d.hrHistory = hr;
    const vals = hr.map(h => h.v).filter(v => v);
    if (vals.length) {
      d.hrSummary = { avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), max: Math.max(...vals), min: Math.min(...vals) };
    }
    d.perHour = Math.round(s.activity / Math.max(1, this._count * 3 / 3600));

    // 温湿度趋势
    d.tempHistory = [...this.data.tempHistory, { v: s.temperature, t: new Date().toLocaleTimeString() }].slice(-10);
    d.humHistory = [...this.data.humHistory, { v: s.humidity, t: new Date().toLocaleTimeString() }].slice(-10);

    this.setData(d);
  }
});
