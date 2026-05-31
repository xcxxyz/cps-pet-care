const app = getApp();

Page({
  data: {
    heartRate: '--', activityToday: 0,
    hrSummary: { avg: '--', max: '--', min: '--' }
  },
  history: { hr: [], temp: [], hum: [], act: [] },
  canvasCtx: null,
  canvasReady: false,

  onLoad() {
    this._onData = this._onData.bind(this);
    app.subscribe(this._onData);
    this.initCanvas();
  },
  onUnload() { app.unsubscribe(this._onData); },

  initCanvas() {
    const query = wx.createSelectorQuery();
    query.select('#chart')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (res[0]) {
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = wx.getSystemInfoSync().pixelRatio;
          canvas.width = res[0].width * dpr;
          canvas.height = res[0].height * dpr;
          ctx.scale(dpr, dpr);
          this.canvasCtx = ctx;
          this.canvasW = res[0].width;
          this.canvasH = res[0].height;
          this.canvasReady = true;
        }
      });
  },

  _onData(_, g) {
    const s = g.latest;
    const t = new Date().toLocaleTimeString().slice(0, 5);
    const d = {
      heartRate: s.heartrate || '--',
      activityToday: s.activity || 0,
      hrSummary: this.calcSummary(this.history.hr)
    };

    // 累积历史数据
    if (s.heartrate) this.history.hr.push({ v: s.heartrate, t });
    if (s.temperature !== undefined) this.history.temp.push({ v: s.temperature, t });
    if (s.humidity !== undefined) this.history.hum.push({ v: s.humidity, t });
    if (s.activity !== undefined) this.history.act.push({ v: s.activity, t });

    // 只保留最近 60 个点
    for (const k of ['hr', 'temp', 'hum', 'act']) {
      if (this.history[k].length > 60) this.history[k] = this.history[k].slice(-60);
    }
    this.setData(d);
    if (this.canvasReady) this.drawChart();
  },

  calcSummary(arr) {
    if (!arr.length) return { avg: '--', max: '--', min: '--' };
    const vs = arr.map(x => x.v);
    return {
      avg: Math.round(vs.reduce((a, b) => a + b, 0) / vs.length),
      max: Math.max(...vs),
      min: Math.min(...vs)
    };
  },

  drawChart() {
    const ctx = this.canvasCtx;
    const W = this.canvasW;
    const H = this.canvasH;
    const data = this.history.temp; // 默认展示温度
    const datasets = [
      { data: this.history.temp, label: '温度°C', color: '#ff6b6b', min: 10, max: 40 },
      { data: this.history.hum, label: '湿度%', color: '#4ecdc4', min: 20, max: 100 },
      { data: this.history.hr, label: '心率', color: '#a29bfe', min: 60, max: 120 }
    ];

    ctx.clearRect(0, 0, W, H);
    if (!datasets[0].data.length) return;

    const n = datasets[0].data.length;
    const pad = { top: 20, right: 10, bottom: 30, left: 35 };
    const pw = W - pad.left - pad.right;
    const ph = H - pad.top - pad.bottom;

    // 柱宽动态压缩：初始 24px，最小 2px
    const barW = Math.max(2, Math.min(24, pw / n - 1));
    const gap = barW >= 4 ? 1 : 0;
    const isLine = barW <= 3; // 太窄时切换为曲线

    // 绘制网格
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + ph * i / 4;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    }

    for (const ds of datasets) {
      if (!ds.data.length) continue;
      const range = ds.max - ds.min;

      if (isLine) {
        // === 填充曲线模式 ===
        ctx.beginPath();
        ctx.strokeStyle = ds.color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';

        const points = ds.data.map((p, i) => ({
          x: pad.left + i * (pw / Math.max(n - 1, 1)),
          y: pad.top + ph - (p.v - ds.min) / range * ph
        }));

        ctx.moveTo(points[0].x, H - pad.bottom);
        for (const pt of points) ctx.lineTo(pt.x, pt.y);
        ctx.lineTo(points[points.length - 1].x, H - pad.bottom);
        ctx.closePath();

        // 渐变填充
        const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
        grad.addColorStop(0, ds.color + '40');
        grad.addColorStop(1, ds.color + '05');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.stroke();
      } else {
        // === 柱形图模式 ===
        ctx.fillStyle = ds.color + '99';
        for (let i = 0; i < ds.data.length; i++) {
          const x = pad.left + i * (pw / Math.max(n - 1, 1)) - barW / 2;
          const h = (ds.data[i].v - ds.min) / range * ph;
          const y = pad.top + ph - h;
          ctx.fillRect(x, y, barW, h);
        }
      }
    }

    // Y 轴标签
    ctx.fillStyle = '#999';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    const ds0 = datasets[0];
    const range0 = ds0.max - ds0.min;
    for (let i = 0; i <= 4; i++) {
      const v = ds0.min + range0 * (4 - i) / 4;
      ctx.fillText(Math.round(v), pad.left - 4, pad.top + ph * i / 4 + 3);
    }

    // X 轴标签（首尾时间）
    ctx.textAlign = 'center';
    if (datasets[0].data.length > 0) {
      ctx.fillText(datasets[0].data[0].t, pad.left, H - 5);
      ctx.fillText(datasets[0].data[datasets[0].data.length - 1].t, W - pad.right, H - 5);
    }
  }
});
