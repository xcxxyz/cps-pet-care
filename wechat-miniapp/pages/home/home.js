const app = getApp();

Page({
  data: {
    temperature: '--', humidity: '--', heartRate: '--',
    activityCount: 0, ledBrightness: 0, brightnessPct: '0',
    fanOn: false, visionType: '', visionBehavior: '', updateTime: ''
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
          temperature: s.temperature || '--',
          humidity: s.humidity || '--',
          heartRate: s.heartrate || '--',
          activityCount: s.activity || 0,
          ledBrightness: s.led || 0,
          brightnessPct: Math.round((s.led || 0) / 255 * 100).toString(),
          fanOn: s.fanOn === 1 || s.fanOn === true,
          visionType: s.vision_type || '',
          visionBehavior: s.vision_behavior || '',
          updateTime: new Date().toLocaleTimeString()
        });
      }
    });
  }
});
