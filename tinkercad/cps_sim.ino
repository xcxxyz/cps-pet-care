/*
 * CPS智能宠物看护系统 - Tinkercad仿真版
 * 模拟：温湿度监测 + 自动喂食 + LED灯光 + 活动检测
 */

#include <DHT.h>
#include <Servo.h>
#include <LiquidCrystal.h>

// 引脚
#define DHTPIN      2
#define DHTTYPE     DHT11
#define SERVO_PIN   9
#define LED_PIN     5
#define PIR_PIN     4
#define BUZZER_PIN  6
#define BTN_FEED    7
#define BTN_LIGHT   8

// LCD (RS, E, D4, D5, D6, D7)
LiquidCrystal lcd(12, 11, A0, A1, A2, A3);

DHT dht(DHTPIN, DHTTYPE);
Servo feeder;

// 状态
int temperature = 0, humidity = 0;
int activityCount = 0;
bool ledOn = false;
bool feeding = false;
bool motionDetected = false;
unsigned long lastMotion = 0;
unsigned long lastReport = 0;
unsigned long feedTimer = 0;
const int FEED_DURATION = 2000;

void setup() {
  Serial.begin(9600);

  dht.begin();
  feeder.attach(SERVO_PIN);
  feeder.write(0);  // 关闭

  pinMode(LED_PIN, OUTPUT);
  pinMode(PIR_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(BTN_FEED, INPUT_PULLUP);
  pinMode(BTN_LIGHT, INPUT_PULLUP);

  digitalWrite(LED_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);

  lcd.begin(16, 2);
  lcd.setCursor(0, 0);
  lcd.print("Smart Pet Care");
  lcd.setCursor(0, 1);
  lcd.print("System Ready");

  Serial.println("CPS Pet Care System Ready");
  delay(2000);
  lcd.clear();
}

void loop() {
  unsigned long now = millis();

  // === 温度/湿度读取 ===
  if (now - lastReport >= 2000) {
    lastReport = now;
    float t = dht.readTemperature();
    float h = dht.readHumidity();

    if (!isnan(t) && !isnan(h)) {
      temperature = (int)t;
      humidity = (int)h;

      lcd.setCursor(0, 0);
      lcd.print("T:");
      lcd.print(temperature);
      lcd.print((char)223);
      lcd.print("C H:");
      lcd.print(humidity);
      lcd.print("%  ");

      // 高温告警
      if (temperature > 28) {
        digitalWrite(BUZZER_PIN, HIGH);
        delay(200);
        digitalWrite(BUZZER_PIN, LOW);
      }

      Serial.print("温度:");
      Serial.print(temperature);
      Serial.print(" 湿度:");
      Serial.println(humidity);
    }
  }

  // === PIR 活动检测 ===
  int pir = digitalRead(PIR_PIN);
  if (pir == HIGH && !motionDetected) {
    motionDetected = true;
    activityCount++;
    lastMotion = now;

    lcd.setCursor(0, 1);
    lcd.print("Motion! ");
    lcd.print(activityCount);

    Serial.print("活动次数:");
    Serial.println(activityCount);
    delay(500);
  }
  if (pir == LOW && motionDetected) {
    motionDetected = false;
    lcd.setCursor(0, 1);
    lcd.print("                ");
  }

  // === 按钮：手动喂食 ===
  if (digitalRead(BTN_FEED) == LOW && !feeding) {
    startFeeding(now);
  }

  // === 按钮：灯光开关 ===
  if (digitalRead(BTN_LIGHT) == LOW) {
    delay(50);
    if (digitalRead(BTN_LIGHT) == LOW) {
      ledOn = !ledOn;
      digitalWrite(LED_PIN, ledOn ? HIGH : LOW);
      Serial.print("灯光:");
      Serial.println(ledOn ? "开" : "关");
      delay(300);
    }
  }

  // === 喂食完成 ===
  if (feeding && now - feedTimer >= FEED_DURATION) {
    feeder.write(0);
    feeding = false;
    lcd.setCursor(8, 1);
    lcd.print("Fed! ");
    Serial.println("喂食完成");
  }

  // === 长时间无活动告警 ===
  if (now - lastMotion > 60000 && lastMotion > 0) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(100);
    digitalWrite(BUZZER_PIN, LOW);
  }

  delay(50);
}

void startFeeding(unsigned long now) {
  feeding = true;
  feedTimer = now;
  feeder.write(90);
  Serial.println("开始喂食");

  lcd.setCursor(8, 1);
  lcd.print("Feed..");
}
