const app = getApp();

Page({
  data: {
    temperature: '--', humidity: '--', heartRate: '--',
    activityCount: 0, ledBrightness: 0, brightnessPct: '0',
    fanOn: false, visionType: '', visionBehavior: '', updateTime: ''
  },

  onLoad() {
    this._update = (props) => {
      const s = app.globalData.latest;
      this.setData({
        temperature: s.temperature ?? '--',
        humidity: s.humidity ?? '--',
        heartRate: s.heartrate ?? '--',
        activityCount: s.activity || 0,
        ledBrightness: s.led || 0,
        brightnessPct: Math.round((s.led || 0) / 255 * 100).toString(),
        fanOn: s.fanOn === 1 || s.fanOn === true,
        visionType: s.vision_type || '',
        visionBehavior: s.vision_behavior || '',
        updateTime: new Date().toLocaleTimeString()
      });
    };
    app.subscribe(this._update);
    // 初始加载
    this._update();
  },

  onUnload() {
    app.unsubscribe(this._update);
  }
});
