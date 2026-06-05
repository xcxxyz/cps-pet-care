# CPS Pet Care — 经验教训总结

## 1. MQTT 变长整数编码：unshift vs push（根因bug）

**问题**: 自定义MQTT库中 `buildPacket` 函数用 `rl.unshift()` 构造剩余长度字节，导致字节序颠倒。
**根因**: MQTT Variable Byte Integer 是小端序(低位7bit在前)，`unshift` 头部插入导致高位在前。
**修复**: `unshift` → `push`，一行代码的事。
**耗时**: 排查了2-3小时，经历了换域名、改协议版本、改ClientId格式、换认证方式等弯路。
**教训**: 协议编码细节要验证——写完之后逐字节跟标准库的输出比对，不要假设"看起来对"。

## 2. IoTDA WSS URL 不能带端口号

**问题**: `wss://host:443/mqtt` 能连接、能发、能订阅，但永远收不到IoTDA规则转发的数据。
**根因**: IoTDA的WSS实现对`:443`端口号不做处理，转发数据投递失败。
**修复**: 去掉端口号 → `wss://host/mqtt`，数据立即到达。
**教训**: 协议标准不等于平台实现。`:443` 在URI标准里等同于默认端口，但IoTDA不认。

## 3. DevTools TLS vs 真机 TLS

**问题**: Windows微信开发者工具连IoTDA WSS一直timeout，Node.js和真机都正常。
**根因**: 微信DevTools(Windows)的TLS栈与IoTDA的WSS证书链有兼容性问题。
**解决**: 真机测试+开发环境bridge WebSocket fallback。
**教训**: DevTools ≠ 真机。遇到TLS问题先上真机验证，别在工具上死磕。

## 4. ClientId 格式：WSS vs MQTTS

**问题**: MQTTS设备用 `{deviceId}_0_0_{timestamp}`，WSS设备需要用 `{deviceId}_0_1_{timestamp}`。
**发现**: 华为云官方MQTT鉴权工具的输出揭示了格式差异——中间的数字表示连接模式。
**教训**: 不同协议的接入参数可能不同，官方工具生成的才是标准答案。

## 5. 数据转发规则排查

**经历**: SQL WHERE语法踩坑多轮——
- `=` 只支持整数比较，字符串必须用 `IN` 或 `LIKE`
- SQL编辑器不认识的字段路径会标红
- 快速配置比手写SQL更可靠
- 转发目标「设备」Topic填设备相对路径 `sys/messages/down`，不带 `$oc/devices/...` 前缀
**教训**: IoTDA规则引擎的SQL是阉割版的，先快速配置生成模板再改。

## 6. 接入凭证 ≠ 设备凭证

**经历**: accessKey + accessCode 在MQTTS和WSS上都认证失败(无论instanceId怎么填)。
**结论**: "预置接入凭证"可能只用于AMQP/API，不适用于设备MQTT连接。
**教训**: 不要假设一套凭证哪里都能用。

## 7. 整体流程教训

1. **先验证再实现**: Node.js快速原型验证每个环节(连接/发布/订阅/转发)，确认可行再写小程序代码。
2. **最小化差异排查**: 当小程序不通但Node.js通时，应逐字节比对两者发出的MQTT包——这就是找到unshift bug的最短路径。
3. **不要同时改多个变量**: 排查期间同时改了URL格式、协议版本、ClientId、密码算法，无法确定哪个生效。
4. **官方工具最高权威**: IoTDA鉴权工具生成的三元组是标准答案，代码输出与之不符就是代码错了。
