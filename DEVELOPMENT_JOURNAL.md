# CPS Pet Care — 开发全记录

> 从零到全链路IoT数据互通，记录每一个关键问题、排查过程和解决方案。

---

## 第一阶段：架构搭建（2026-06-03 ~ 06-04）

### 初始架构设计
```
Wokwi(ESP32) ←串口→ wokwi-bridge.py ←HTTP→ bridge(server.js) ←MQTT→ 华为云IoTDA ←WSS→ 微信小程序
```

### 组件分工
- **Wokwi ESP32**: 仿真硬件（DHT22温湿度、光敏、PIR、LED、舵机、风扇），每3秒输出传感器数据
- **wokwi-bridge.py**: RFC2217串口→HTTP桥接，负责读取Wokwi串口数据并转发
- **bridge/server.js**: 核心中转，MQTT连华为云，WebSocket连小程序，HTTP接收传感器
- **微信小程序**: 四个页面（首页/控制/数据/设置），显示传感器+下发控制命令

### 初期已完成功能
- ESP32固件：传感器采集、LED PWM调光、舵机控制、风扇温控
- 基础数据流：Wokwi → bridge → WebSocket → 小程序
- MQTT上报：bridge → 华为云IoTDA

---

## 第二阶段：华为云IoTDA数据通路打通（2026-06-05）

### 问题1：IoTDA规则引擎配置
**现象**: 两条设备间通信规则创建后TPS为0
**排查**: 
- MQTT直接连接测试，确认设备认证通过
- 发现SQL过滤语句中`=`运算符只支持整数比较，device_id需要`IN`或`LIKE`
- FROM子句在带WHERE时不被识别
**解决**: 使用快速配置代替手写SQL，通过`notify_data.body.topic`过滤指定设备的topic

### 问题2：转发目标Topic格式
**现象**: "topic不合法"错误反复出现
**排查**: 尝试了完整路径`$oc/devices/...`、设备相对路径`sys/properties/set`等多种格式
**解决**: 转发目标Topic填`sys/messages/down`（设备相对路径，不带全前缀）

### 问题3：WSS URL端口号
**现象**: Node.js WSS测试能收数据，小程序自定义MQTT库连上后收不到
**关键发现**: `wss://host:443/mqtt`能连接但收不到转发数据，`wss://host/mqtt`（不带端口号）正常
**教训**: IoTDA的WSS实现对`:443`端口号不做处理，导致转发数据投递失败

### 问题4：MQTT变长整数编码
**现象**: 自定义mqtt.js发送CONNECT包后IoTDA不回复CONNACK
**根因**: `buildPacket`函数中剩余长度用`unshift`（头部插入）编码，导致字节序为大端，MQTT要求小端序
**解决**: `rl.unshift()` → `rl.push()`
**教训**: 协议编码细节必须逐字节验证，不能假设"看起来对"

### 问题5：ClientId格式
**现象**: 用`_0_0_`格式的ClientId连接WSS无响应
**解决**: 华为云官方MQTT鉴权工具生成的ClientId用`_0_1_`格式（WSS模式），修改后立即通
**发现**: `_0_0_`是MQTTS格式，`_0_1_`是WSS格式

### 问题6：设备WSS认证
**先前的错误尝试**: 尝试使用accessKey+accessCode（预置接入凭证）连接WSS，无论MQTT 3.1.1还是5.0，无论是否带instanceId，全部返回"Bad username or password"
**结论**: 预置接入凭证用于AMQP/API接入，不适用于设备MQTT连接
**正确方式**: 设备WSS连接仍使用设备ID+HMAC-SHA256(时间戳, 密钥)

---

## 第三阶段：串口双向通信（2026-06-05 晚间）

### 问题7：Wokwi RFC2217串口双向阻塞
**这是整个项目最棘手的问题**

**现象**: 传感器数据（ESP32 TX）正常输出，但任何命令（ESP32 RX）写不进去
**排查过程**（耗时约4小时）:

| 测试方式 | 结果 |
|------|------|
| wokwi-bridge 边读边写（同连接） | ESP32收不到 |
| wokwi-bridge 关连接→新建写→关→重建读 | ESP32收不到 |
| Python独立脚本写（wokwi-bridge在读） | ESP32收不到 |
| Python独立脚本写（wokwi-bridge已停） | ESP32收到了 |

**根因**: Wokwi VS Code扩展的RFC2217串口服务采用独占连接模式。只要有一个客户端连接着持续读取，任何其他连接（包括同一进程重建的连接）都无法向ESP32 RX写入数据。
**性质**: Wokwi仿真器本身的平台限制，不是代码bug

### 尝试过的方案

**方案A: ESP32多串口（UART0+UART2）**
- 固件改用Serial2（UART2, GPIO18/19）接收命令，Serial（UART0）输出传感器
- 问题: Wokwi只暴露一个RFC2217端口（4000），$serialMonitor2无法从外部访问
- 结果: 不可行

**方案B: WiFi + TCP服务器**
- ESP32连接Wokwi-GUEST WiFi，启动TCP服务器(8080端口)
- 配置wokwi.toml端口转发: `from="localhost:8080" to="target:8080"`
- 问题: Wokwi的WiFi端口转发不支持入站TCP连接到ESP32的WiFiServer
- 结果: TCP连接建立但ESP32收不到数据

**方案C: 轮询（Polling）**
- wokwi-bridge每3秒开串口抓一次数据，抓完关闭，留2秒窗口给命令写入
- 问题: 时序不稳定，命令窗口期内写操作有时通有时不通
- 结果: 不可靠

**方案D: 杀进程→写→重启**
- 每个命令到来时: 杀wokwi-bridge → Python写串口 → 重启wokwi-bridge
- 问题: 传感器数据中断2-3秒，LED等状态瞬间丢失
- 结果: 功能可靠但用户体验差

**方案E: 单连接同读写（最终采用）**
- 同一个RFC2217连接上通过`ser.read()`读数据，通过`ser.write()`写命令
- 关键: 命令必须以`\r\n`结尾（不是`\n`），串口超时设0.3秒
- 结果: 读写互不干扰，传感器数据不间断，命令立即生效

### 方案E的实现细节
```python
ser = serial.serial_for_url(PORT, baudrate=115200, timeout=0.3)
while True:
    ch = ser.read(1)    # 0.3秒超时
    if ch: 处理传感器数据
    
    cmd = cmd_queue.get_nowait()   # 非阻塞取命令
    if cmd:
        ser.write((cmd + '\r\n').encode())  # 同连接写
        ser.flush()
```

关键参数:
- `timeout=0.3`: 足够短以快速检测命令，足够长以不漏传感器数据
- `\r\n`: Wokwi ESP32串口要求的行结束符，只用`\n`会导致收不到

---

## 第四阶段：功能完善

### 问题8：风扇阈值逻辑
**现象**: TEMPHIGH=4时温度=3，风扇不关
**根因**: 关风扇需要同时满足`温度≤tempHigh-1 AND 湿度≤humHigh-3`，湿度48不满足≤47
**解决**: 改为只要温度或湿度超过阈值就开，都不超就关（去掉回差耦合）

### 问题9：LED调光回跳
**现象**: 快速拖滑块时亮度值跳回旧值
**根因**: 小程序本地UI立即更新，但IoTDA转发的旧状态数据覆盖了新值
**解决**: 命令确认制——发命令时记录期望值，收到匹配的返回才接受，不匹配的旧数据跳过，5秒超时

### 问题10：阈值命令重复发送
**现象**: 保存设置后串口收到十几次相同的TEMPHIGH和HUMHIGH
**根因**: IoTDA消息被多次转发，桥重复处理
**解决**: 三重去重——MQTT/WebSocket/HTTP三个入口都加值未变就跳过的逻辑

---

## 关键技术决策

| 决策 | 原因 |
|------|------|
| 自定义mqtt.js而非npm mqtt | 微信小程序不支持Node.js内置模块（events/stream等） |
| MQTT 3.1.1 而非 5.0 | IoTDA WSS对MQTT 5.0 CONNECT不回应 |
| 设备认证而非接入凭证 | accessKey+accessCode在WSS/MQTTS上全部认证失败 |
| 小程序双模连接 | IoTDA WSS为主，bridge WebSocket为DevTools降级 |
| 单连接同读写 | Wokwi RFC2217独占连接限制的最佳workaround |

---

## 文件清单

| 文件 | 用途 |
|------|------|
| `wokwi/src/main.cpp` | ESP32固件 |
| `wokwi/diagram.json` | Wokwi电路图 |
| `wokwi/wokwi.toml` | Wokwi配置 |
| `bridge/server.js` | 核心桥接服务 |
| `bridge/wokwi-bridge.py` | 串口-数据桥接 |
| `bridge/serial-write.py` | 独立串口写入工具 |
| `wechat-miniapp/app.js` | 小程序主逻辑 |
| `wechat-miniapp/utils/mqtt.js` | 自定义MQTT over WebSocket客户端 |
| `wechat-miniapp/utils/hmac-sha256.js` | HMAC-SHA256认证算法 |
| `wechat-miniapp/pages/` | 四个页面（home/control/data/settings） |
