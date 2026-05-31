const app = getApp();

const DISPLAY_W = 300;   // 显示区域固定宽度
const MAX_BARS = 50;     // 超过此数量触发聚合
const BATCH = 5;         // 每 5 个聚合为 1 个特征柱
const MAX_H = 80;        // 最大柱高

// 聚合：每 batch 个数据取平均值，保留首尾时间
function aggregate(arr, batch) {
  const r = [];
  for (let i = 0; i < arr.length; i += batch) {
    const g = arr.slice(i, i + batch);
    const avg = Math.round(g.reduce((s, x) => s + x.v, 0) / g.length);
    r.push({ v: avg, t: g[0].t });
  }
  return r;
}

function makeBars(raw, vmin, vmax) {
  if (!raw.length) return [];
  // 数据超过阈值 → 聚合
  let data = raw;
  if (data.length > MAX_BARS) data = aggregate(data, BATCH);
  // 如果聚合后还是太多，再聚合
  while (data.length > MAX_BARS) data = aggregate(data, BATCH);

  const n = data.length;
  const barW = Math.max(2, Math.floor(DISPLAY_W / n) - 1);
  const gap = n > 30 ? 0 : 1;
  const range = vmax - vmin;

  return data.map(p => ({
    h: Math.max(2, Math.round((p.v - vmin) / range * MAX_H)),
    w: barW,
    g: gap,
    t: p.t
  }));
}

Page({
  data: {
    heartRate: '--', activityToday: 0,
    hrSummary: { avg: '--', max: '--', min: '--' },
    tempBars: [], humBars: [], hrBars: []
  },
  history: { hr: [], temp: [], hum: [] },
  timer: null,

  onLoad() {
    this.fetch();
    this.timer = setInterval(() => this.fetch(), 3000);
  },
  onUnload() { clearInterval(this.timer); },

  fetch() {
    wx.request({
      url: 'http://127.0.0.1:3000/api/state',
      success: (res) => {
        const s = res.data;
        const t = new Date().toLocaleTimeString().slice(0, 5);
        if (s.heartrate) this.history.hr.push({ v: s.heartrate, t });
        if (s.temperature !== undefined) this.history.temp.push({ v: s.temperature, t });
        if (s.humidity !== undefined) this.history.hum.push({ v: s.humidity, t });

        this.setData({
          heartRate: s.heartrate || '--',
          activityToday: s.activity || 0,
          hrSummary: this.calcSummary(this.history.hr),
          tempBars: makeBars(this.history.temp, 10, 45),
          humBars: makeBars(this.history.hum, 20, 100),
          hrBars: makeBars(this.history.hr, 60, 120)
        });
      }
    });
  },

  calcSummary(arr) {
    if (!arr.length) return { avg: '--', max: '--', min: '--' };
    const vs = arr.map(x => x.v);
    return { avg: Math.round(vs.reduce((a, b) => a + b, 0) / vs.length), max: Math.max(...vs), min: Math.min(...vs) };
  }
});
