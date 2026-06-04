#include <Arduino.h>
#include <DHTesp.h>
#include <ESP32Servo.h>

#define DHT_PIN     27
#define SERVO_PIN   16
#define LED_PIN     25
#define LIGHT_PIN   33
#define PIR_PIN     26
#define FAN_PIN     14

DHTesp dht;
Servo feeder;

int temperature = 0, humidity = 0, lightLevel = 0, ledBrightness = 0;
int activityCount = 0, heartRate = 80;
bool feeding = false, motionDetected = false, fanOn = false, manualLed = false;
unsigned long lastReport = 0, feedTimer = 0;
int tempHigh = 28, humHigh = 75;

void setup() {
  Serial.begin(115200);
  dht.setup(DHT_PIN, DHTesp::DHT22);
  delay(3000);
  feeder.attach(SERVO_PIN); feeder.write(0);
  pinMode(LED_PIN, OUTPUT); pinMode(PIR_PIN, INPUT); pinMode(FAN_PIN, OUTPUT);
  digitalWrite(FAN_PIN, LOW);

  // 首次读取测试
  TempAndHumidity th = dht.getTempAndHumidity();
  Serial.printf("DHT test: T=%.1f H=%.1f isnan(T)=%d isnan(H)=%d\n",
    th.temperature, th.humidity, isnan(th.temperature), isnan(th.humidity));

  Serial.println("CPS Pet Care Ready");
}

void loop() {
  unsigned long now = millis();

  // 读取bridge串口指令
  while (Serial.available()) {
    static String cmdBuf = "";
    char c = (char)Serial.read();
    if (c == '\n') { cmdBuf.trim();
      if (cmdBuf == "LED:auto") {
        manualLed = false;
        ledBrightness = 255 - (lightLevel * 255 / 4095);
        analogWrite(LED_PIN, ledBrightness);
      } else if (cmdBuf.startsWith("LED:")) {
        ledBrightness = constrain(cmdBuf.substring(4).toInt(), 0, 255);
        manualLed = true;
        analogWrite(LED_PIN, ledBrightness);
      }
      cmdBuf = "";
    } else cmdBuf += c;
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
    else if (temperature <= tempHigh - 1 && humidity <= humHigh - 3)
      { fanOn = false; digitalWrite(FAN_PIN, LOW); }
    heartRate = 80 + random(-5, 8);

    Serial.printf("T:%d H:%d L:%d LED:%d HR:%d ACT:%d FAN:%d\n",
      temperature, humidity, lightLevel, ledBrightness, heartRate, activityCount, fanOn);
  }

  int pir = digitalRead(PIR_PIN);
  if (pir == HIGH && !motionDetected) { motionDetected = true; activityCount++; delay(300); }
  if (pir == LOW) motionDetected = false;

  if (!feeding && now > 15000 && now % 30000 < 5000) {
    feeding = true; feedTimer = now; feeder.write(90);
    Serial.println("FEED:1");
  }
  if (feeding && now - feedTimer >= 2000) {
    feeder.write(0); feeding = false;
    Serial.println("FEED:0");
  }
  delay(10);
}
