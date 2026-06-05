# CPS Pet Care — 完整架构文档

## 项目概述
CPS智能宠物看护系统：ESP32仿真(Wokwi) → bridge → 华为云IoTDA → 微信小程序。
全链路双向MQTT数据互通。温度、湿度、光照、心率实时监控；LED调光、喂食舵机、风扇远程控制。

## 最终架构

```
┌─────────────────────────────────────────────────────────┐
│                      华为云 IoTDA                        │
│  ┌──────────┐  规则引擎   ┌──────────┐                   │
│  │ bridge_0 │◄──────────►│  led0    │                   │
│  │(MQTTS)   │            │(WSS小程序)│                   │
│  └────┬─────┘            └────┬─────┘                   │
└───────┼──────────────────────┼──────────────────────────┘
        │ MQTTS:8883           │ WSS:443/mqtt
        │                      │
   ┌────▼────┐           ┌─────▼──────┐
   │ bridge  │           │ 微信小程序  │
   │(Node.js)│◄──WS:3000─│  (真机)    │
   └────┬────┘           └────────────┘
        │ HTTP:3000
   ┌────▼────────┐
   │wokwi-bridge │
   │(Python)     │
   └────┬────────┘
        │ RFC2217:4000
   ┌────▼────┐
   │  Wokwi  │
   │ ESP32   │
   └─────────┘
```

### 数据流

**上行（传感器→小程序）:**
ESP32串口 → wokwi-bridge(4000) → HTTP(3000) → bridge.js → MQTT → IoTDA → 规则转发 → WSS → 小程序

**下行（小程序命令→ESP32）:**
小程序 → WSS → IoTDA → 规则转发 → MQTT → bridge.js → HTTP(3001) → wokwi-bridge → 串口 → ESP32

## 组件详解

### 1. Wokwi ESP32 仿真 (`wokwi/`)
- 芯片: ESP32 DevKit C V4 (PlatformIO编译)
- 传感器: DHT22(温湿度), 光敏电阻(滑变模拟), PIR人体感应
- 执行器: LED(黄/D25 PWM调光), 舵机(D16/喂食), 风扇(红LED/D14)
- 串口输出: `T:3 H:48 L:0 LED:255 HR:80 ACT:0 FAN:0` (每3秒)
- 命令格式: `LED:xxx`, `LED:auto`, `FEED:NOW`, `TEMPHIGH:xxx`, `HUMHIGH:xxx`
- 命令结尾: **必须`\r\n`**

### 2. wokwi-bridge.py (`bridge/wokwi-bridge.py`)
- 单连接双向: 同一RFC2217连接上读写互不干扰
- 关键配置: `timeout=0.3`, 写命令用`\r\n`
- HTTP API: 端口3001接收命令, 端口3000推送传感器数据

### 3. Bridge Server (`bridge/server.js`)
- MQTT: 设备bridge_0连接IoTDA, 发布`sys/messages/up`, 订阅`sys/messages/down`
- WebSocket: 端口3000, 广播传感器数据, 接收控制命令
- HTTP: 端口3000, POST /api/data接收Wokwi数据
- 认证: HMAC-SHA256(key=时间戳UTC小时, data=设备密钥)
- 去重: tempHigh/humHigh值未变不重复写串口

### 4. 微信小程序 (`wechat-miniapp/`)
- IoTDA连接: MQTT over WSS, 设备led0
- URL: `wss://host/mqtt` (不能带端口号)
- ClientId: `{deviceId}_0_1_{timestamp}` (WSS模式)
- 密码: HMAC-SHA256(key=时间戳, data=密钥)
- 协议: MQTT 3.1.1
- 自定义mqtt.js (微信不支持npm mqtt库)
- 命令确认制: LED/ledMode发命令后只接受匹配的返回值
- 四个页面: Home(仪表盘), Control(LED/喂食/风扇), Data(图表), Settings(阈值/计划)

### 5. 华为云IoTDA
- 产品ID: `69fc054c7f2e6c302f6e5dfd`
- 设备: `bridge_0`(MQTTS), `led0`(WSS)
- 规则: app_to_bridge(命令下行), bridge_to_app(数据上行)
- 转发目标: 设备, Topic `sys/messages/down`

## 引脚连接
| 元件 | 引脚 |
|------|------|
| DHT22 | D27 |
| 舵机 | D16 |
| LED(黄) | D25 |
| 光敏 | D33 |
| PIR | D26 |
| 风扇(红LED) | D14 |

## 功能状态
| 功能 | 状态 |
|------|------|
| 传感器数据实时显示 | ✅ |
| LED手动调光+自动调光 | ✅ |
| 手动喂食+定时喂食 | ✅ |
| 温度阈值风扇控制 | ✅ |
| 湿度阈值风扇控制 | ✅ |
| 心率阈值存储 | ✅ |
| 小程序↔华为云↔Wokwi全链路 | ✅ |
