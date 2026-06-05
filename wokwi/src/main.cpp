#include <Arduino.h>
#include <DHTesp.h>
#include <WiFi.h>
// 不用 ESP32Servo，直接 LEDC PWM 驱动舵机

#define DHT_PIN     27
#define SERVO_PIN   16
#define LED_PIN     25
#define LIGHT_PIN   33
#define PIR_PIN     26
#define FAN_PIN     14

DHTesp dht;

// 舵机 PWM 通道和占空比
#define SERVO_CH    8
#define SERVO_FREQ  50   // 50Hz
#define SERVO_RES   12   // 12-bit resolution (0-4095)
// 0° = 500us → duty = 500/20000*4096 ≈ 102
// 180° = 2400us → duty = 2400/20000*4096 ≈ 492
#define SERVO_MIN   102
#define SERVO_MAX   492
#define servoWrite(a) ledcWrite(SERVO_CH, map(a, 0, 180, SERVO_MIN, SERVO_MAX))

int temperature = 0, humidity = 0, lightLevel = 0, ledBrightness = 0;
int activityCount = 0, heartRate = 80;
bool feeding = false, motionDetected = false, fanOn = false, manualLed = false;
unsigned long lastReport = 0, feedTimer = 0, lastDayReset = 0;
int tempHigh = 28, humHigh = 75;

WiFiServer tcpServer(8080);

void processCmd(String cmdBuf, unsigned long now);

void setup() {
  Serial.begin(115200);                             // UART0: 传感器数据输出
  // 命令通过 Serial (UART0) 接收
  dht.setup(DHT_PIN, DHTesp::DHT22);
  delay(3000);
  ledcSetup(SERVO_CH, SERVO_FREQ, SERVO_RES);
  ledcAttachPin(SERVO_PIN, SERVO_CH);
  servoWrite(0); delay(500);
  pinMode(LED_PIN, OUTPUT); pinMode(PIR_PIN, INPUT); pinMode(FAN_PIN, OUTPUT);
  digitalWrite(FAN_PIN, LOW);

  // 首次读取测试
  TempAndHumidity th = dht.getTempAndHumidity();
  Serial.printf("DHT test: T=%.1f H=%.1f isnan(T)=%d isnan(H)=%d\n",
    th.temperature, th.humidity, isnan(th.temperature), isnan(th.humidity));

  Serial.println("CPS Pet Care Ready");

  // WiFi + TCP 服务器（Wokwi-GUEST 无需密码，频道 6）
  WiFi.begin("Wokwi-GUEST", "", 6);
  int wifiTry = 0;
  while (WiFi.status() != WL_CONNECTED && wifiTry++ < 20) { delay(500); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? "\nWiFi OK" : "\nWiFi FAIL");
  tcpServer.begin();
  Serial.println("TCP server on port 8080");
}

void loop() {
  unsigned long now = millis();

  // 串口命令（UART2: RX=18, TX=19）
  while (Serial.available()) {
    static String cmdBuf = "";
    char c = (char)Serial.read();
    if (c == '\n') {
      cmdBuf.trim();
      processCmd(cmdBuf, now);
      cmdBuf = "";
    } else {
      cmdBuf += c;
    }
  }

  if (now - lastReport >= 3000) {
    lastReport = now;
    TempAndHumidity th = dht.getTempAndHumidity();
    if (!isnan(th.temperature) && !isnan(th.humidity) && th.temperature > -50) {
      temperature = (int)th.temperature;
      humidity = (int)th.humidity;
    }
    lightLevel = analogRead(LIGHT_PIN);
    if (!manualLed)
      ledBrightness = 255 - (lightLevel * 255 / 4095);
    analogWrite(LED_PIN, ledBrightness);

    if (temperature > tempHigh || humidity > humHigh)
      { fanOn = true; digitalWrite(FAN_PIN, HIGH); }
    else
      { fanOn = false; digitalWrite(FAN_PIN, LOW); }
    heartRate = 80 + random(-5, 8);

    Serial.printf("T:%d H:%d L:%d LED:%d HR:%d ACT:%d FAN:%d\n",
      temperature, humidity, lightLevel, ledBrightness, heartRate, activityCount, fanOn);
  }

  int pir = digitalRead(PIR_PIN);
  if (pir == HIGH && !motionDetected) { motionDetected = true; activityCount++; delay(300); }
  if (pir == LOW) motionDetected = false;
  if (now - lastDayReset > 86400000UL) { activityCount = 0; lastDayReset = now; }

  if (feeding && millis() - feedTimer >= 3000) {
    servoWrite(0); feeding = false;
    Serial.println("FEED:0");
  }
  // TCP 客户端处理——从 bridge 接收命令
  WiFiClient tcpCli = tcpServer.available();
  if (tcpCli && tcpCli.connected()) {
    while (tcpCli.available()) {
      static String tcpBuf = "";
      char c = (char)tcpCli.read();
      if (c == '\n') { tcpBuf.trim(); processCmd(tcpBuf, now); tcpBuf = ""; }
      else tcpBuf += c;
    }
  }
  delay(10);
}

// 统一命令处理
void processCmd(String cmdBuf, unsigned long now) {
  Serial.printf("RX:%s\n", cmdBuf.c_str());
  if (cmdBuf == "LED:auto") {
    manualLed = false;
    ledBrightness = 255 - (lightLevel * 255 / 4095);
    analogWrite(LED_PIN, ledBrightness);
  } else if (cmdBuf.startsWith("LED:")) {
    ledBrightness = constrain(cmdBuf.substring(4).toInt(), 0, 255);
    manualLed = true;
    analogWrite(LED_PIN, ledBrightness);
  } else if (cmdBuf == "FEED:NOW") {
    if (!feeding) {
      feeding = true; feedTimer = now;
      servoWrite(180);
      Serial.println("FEED:1");
    }
  } else if (cmdBuf.startsWith("TEMPHIGH:")) {
    tempHigh = constrain(cmdBuf.substring(9).toInt(), -20, 60);
    Serial.printf("TEMPHIGH:%d\n", tempHigh);
  } else if (cmdBuf.startsWith("HUMHIGH:")) {
    humHigh = constrain(cmdBuf.substring(8).toInt(), 0, 100);
    Serial.printf("HUMHIGH:%d\n", humHigh);
  }
}
