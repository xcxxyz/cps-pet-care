const app = getApp();

const DISPLAY_W = 300;
const MAX_PTS = 50;
const BATCH = 5;
const CHART_H = 160;

function aggregate(arr, batch) {
  const r = [];
  for (let i = 0; i < arr.length; i += batch) {
    const g = arr.slice(i, i + batch);
    r.push({ v: Math.round(g.reduce((s, x) => s + x.v, 0) / g.length), t: g[0].t });
  }
  return r;
}

function getPoints(raw) {
  let data = raw;
  if (data.length > MAX_PTS) data = aggregate(data, BATCH);
  while (data.length > MAX_PTS) data = aggregate(data, BATCH);
  return data;
}

Page({
  data: {
    heartRate: '--', activityToday: 0,
    hrSummary: { avg: '--', max: '--', min: '--' }
  },
  history: { hr: [], temp: [], hum: [] },
  charts: {}, ready: 0,

  onLoad() {
    const ids = ['cTemp', 'cHum', 'cHR'];
    ids.forEach(id => {
      const q = wx.createSelectorQuery();
      q.select('#' + id).fields({ node: true, size: true }).exec((res) => {
        if (res[0]) {
          const c = res[0].node;
          const ctx = c.getContext('2d');
          const dpr = wx.getSystemInfoSync().pixelRatio;
          c.width = res[0].width * dpr;
          c.height = res[0].height * dpr;
          ctx.scale(dpr, dpr);
          this.charts[id] = { ctx, w: res[0].width, h: res[0].height };
          this.ready++;
          if (this.ready >= 3) { this._tick(); app.subscribe(this._update); }
        }
      });
    });
  },

  onUnload() { app.unsubscribe(this._update); },

  _update: null,

  _tick() {
    this._update = () => {
      const s = app.globalData.latest;
      const t = new Date().toLocaleTimeString().slice(0, 5);
      if (s.heartrate) this.history.hr.push({ v: s.heartrate, t });
      if (s.temperature !== undefined) this.history.temp.push({ v: s.temperature, t });
      if (s.humidity !== undefined) this.history.hum.push({ v: s.humidity, t });
      for (const k of ['hr', 'temp', 'hum']) {
        if (this.history[k].length > 500) this.history[k] = this.history[k].slice(-300);
      }
      this.setData({
        heartRate: s.heartrate ?? '--',
        activityToday: s.activity || 0,
        hrSummary: this.calcSummary(this.history.hr)
      });
      this.drawAll();
    };
    this._update();
  },

  calcSummary(arr) {
    if (!arr.length) return { avg: '--', max: '--', min: '--' };
    const vs = arr.map(x => x.v);
    return { avg: Math.round(vs.reduce((a, b) => a + b, 0) / vs.length), max: Math.max(...vs), min: Math.min(...vs) };
  },

  drawAll() {
    this.drawChart('cTemp', getPoints(this.history.temp), 10, 45, '#ff6b6b');
    this.drawChart('cHum', getPoints(this.history.hum), 20, 100, '#4ecdc4');
    this.drawChart('cHR', getPoints(this.history.hr), 60, 120, '#a29bfe');
  },

  drawChart(id, data, vmin, vmax, color) {
    const ch = this.charts[id];
    if (!ch || !data.length) return;
    const { ctx, w: W, h: H } = ch;

    ctx.clearRect(0, 0, W, H);
    const pad = { top: 14, right: 20, bottom: 22, left: 28 };
    const pw = W - pad.left - pad.right;
    const ph = H - pad.top - pad.bottom;
    const range = vmax - vmin;
    const n = data.length;
    const step = n > 1 ? pw / (n - 1) : pw;

    const pts = data.map((p, i) => ({
      x: pad.left + i * step,
      y: pad.top + ph - (p.v - vmin) / range * ph,
      v: p.v,
      t: p.t
    }));

    ctx.strokeStyle = '#f0f0f0'; ctx.lineWidth = 0.5;
    for (let i = 1; i <= 3; i++) {
      const y = pad.top + ph * i / 4;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(pts[0].x, H - pad.bottom);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(pts[n - 1].x, H - pad.bottom);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    grad.addColorStop(0, color + '40');
    grad.addColorStop(1, color + '05');
    ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    for (let i = 0; i < n; i++) {
      const pt = pts[i];
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    const last = pts[n - 1];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#333';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    const lx = last.x + 8 > W - pad.right ? last.x - 30 : last.x + 8;
    const ly = last.y > 25 ? last.y - 6 : last.y + 16;
    ctx.fillText(last.v, lx, ly);

    ctx.fillStyle = '#999'; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = Math.round(vmin + range * (4 - i) / 4);
      ctx.fillText(v, pad.left - 4, pad.top + ph * i / 4 + 3);
    }

    ctx.fillStyle = '#999'; ctx.textAlign = 'center';
    ctx.fillText(data[0].t, pad.left, H - 4);
    if (n > 1) ctx.fillText(data[n - 1].t, W - pad.right, H - 4);
  }
});
