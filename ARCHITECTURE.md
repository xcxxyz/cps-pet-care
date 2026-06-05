# CPS Pet Care — 完整架构文档

## 项目概述
CPS智能宠物看护系统：ESP32仿真(Wokwi) → bridge → 华为云IoTDA → 微信小程序，双向MQTT数据互通。

## 全链路架构

```
                          华为云 IoTDA
                        ┌──────────────┐
Wokwi(ESP32) ──串口──▶ wokwi-bridge.py ──HTTP──▶ bridge(server.js) ──MQTTS──▶│
  ▲                                                 ▲      │                  │
  │                                                 │      └── WebSocket ──▶ 小程序（开发环境fallback）
  │                                                 │                         │
  └────────── 串口 ◀── wokwi-bridge.py ◀──HTTP──────┘                         │
                                                        WSS ◀─────────────────┘
                                                        小程序（真机/生产环境）
```

## 组件详解

### 1. Wokwi ESP32 仿真 (`wokwi/`)
- **平台**: Wokwi for VS Code (PlatformIO编译)
- **芯片**: ESP32 DevKit C V4
- **传感器**: DHT22(温湿度), 光敏电阻, PIR人体感应, 滑变电位器
- **执行器**: LED(黄D25, PWM调光), 舵机(D16, 喂食), 风扇(红LED D14模拟)
- **固件**: `wokwi/src/main.cpp` (NOT sketch.ino)
- **串口输出格式**: `T:19 H:48 L:0 LED:255 HR:80 ACT:0 FAN:0`
- **串口命令**: `LED:xxx`(手动亮度), `LED:auto`(自动), `FEED:NOW`(喂食), `TEMPHIGH:xxx`, `HUMHIGH:xxx`
- **RFC2217端口**: 4000 (wokwi.toml 配置 `rfc2217ServerPort = 4000`)

### 2. wokwi-bridge.py (`bridge/wokwi-bridge.py`)
- **功能**: RFC2217串口 ↔ HTTP 双向桥接
- **上行**: 读取串口数据 → 正则解析 → HTTP POST 到 `localhost:3000/api/data`
- **下行**: HTTP Server 监听 `localhost:3001` → 接收命令 → 写入串口
- **线程安全**: 主线程串口写入，HTTP线程入队命令

### 3. Bridge Server (`bridge/server.js`)
- **华为云IoTDA连接**: MQTT(mqtts://host:8883) 设备 `bridge_0`
  - 发布: `$oc/devices/{bridge_0}/sys/messages/up` (传感器数据)
  - 订阅: `sys/messages/down` (接收小程序命令)
- **认证**: HMAC-SHA256(key=时间戳UTC小时, data=设备密钥)
  - 时间戳格式: `YYYYMMDDHH` (UTC时间, 取前13位ISO字符串去分隔符)
- **WebSocket服务**: `localhost:3000`
  - 上行: 广播传感器数据 `{type: 'temperature', value: 26}`
  - 下行: 接收命令 `{type: 'led', value: 128}`, `{type: 'feed'}`
- **HTTP API**: `POST /api/data` 接收wokwi-bridge数据
- **仿真回退**: Wokwi串口不通时自动使用模拟数据
- **自收过滤**: bridge收到自己发的传感器数据(含temperature字段)直接忽略

### 4. 微信小程序 (`wechat-miniapp/`)
- **IoTDA连接**: MQTT over WebSocket (WSS)
  - URL: `wss://host/mqtt` (不能带端口号)
  - 设备: `69fc054c7f2e6c302f6e5dfd_led0`
  - ClientId: `{deviceId}_0_1_{timestamp}` (WSS模式用_0_1_)
  - 发布: `$oc/devices/{led0}/sys/messages/up` (命令)
  - 订阅: `sys/messages/down` (接收传感器数据)
  - 协议: MQTT 3.1.1 (protocolLevel: 4)
- **双模fallback**: IoTDA WSS超时15s自动切到bridge WebSocket
- **页面**: Home(仪表盘), Control(LED/喂食), Data(图表), Settings(阈值)
- **自定义MQTT库**: `utils/mqtt.js` — 微信小程序不支持npm mqtt库
  - 关键实现: WebSocket二进制帧收发, MQTT包构造/解析, 变长整数编码(小端序)

### 5. 华为云IoTDA配置
- **产品ID**: `69fc054c7f2e6c302f6e5dfd`
- **设备**: `bridge_0` (MQTTS), `led0` (WSS小程序)
- **规则引擎**: 两条数据转发规则
  - `app_to_bridge`: led0消息 → 转发到设备 → `sys/messages/down`
  - `bridge_to_app`: bridge_0消息 → 转发到设备 → `sys/messages/down`
  - SQL: `SELECT * FROM DEVICE_MESSAGE_REPORT WHERE notify_data.header.product_id='...' AND notify_data.body.topic='...'`
  - 快速配置: 资源空间必须选具体空间(非"所有资源空间")

## 数据流

### 上行 (传感器 → 小程序)
```
ESP32串口 → wokwi-bridge.py(4000) → HTTP(3000/api/data) → bridge.js
  → MQTT发布(sys/messages/up) → IoTDA
  → 规则bridge_to_app转发 → sys/messages/down
  → WSS → 小程序显示
```
数据格式: `{"services":[{"service_id":"pet","properties":{"temperature":19,...}}]}`

### 下行 (小程序命令 → Wokwi)
```
小程序 → WSS发布(sys/messages/up) → IoTDA
  → 规则app_to_bridge转发 → sys/messages/down
  → MQTT → bridge.js → HTTP(3001/api/cmd) → wokwi-bridge.py
  → 串口 → ESP32执行
```
命令格式: `{"services":[{"service_id":"pet","properties":{"led":128}}]}`

## 引脚连接
| 元件 | 引脚 |
|------|------|
| DHT22 | D27 |
| 舵机(Servo) | D16 |
| LED(黄/调光) | D25 |
| 光敏(滑变) | D33 |
| PIR(人体) | D26 |
| LED(红/风扇) | D14 |

## 启动方式
```bash
# 1. VS Code: Ctrl+Shift+P → Wokwi: Start Simulation
# 2. Bridge:
cd cps-pet-care/bridge
python wokwi-bridge.py &
node server.js &
# 3. 微信开发者工具: 编译运行小程序
```

## 关键技术决策
- **为什么不用WSS直连小程序?** 能用，已实现。DevTools有TLS兼容问题，真机正常。
- **为什么MQTT 3.1.1不是5.0?** IoTDA WSS对接时MQTT 5.0 CONNECT包不被识别。
- **为什么ClientId用_0_1_?** WSS模式标识，MQTTS用_0_0_。
- **为什么WSS URL不能带端口号?** IoTDA的WSS实现不对`:443`做处理，导致转发数据无法送达。
