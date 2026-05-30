#include <DHT.h>
#include <ESP32Servo.h>

#define DHT_PIN     27
#define DHT_TYPE    DHT22
#define SERVO_PIN   16
#define LED_PIN     25
#define LIGHT_PIN   33
#define PIR_PIN     26
#define FAN_PIN     14

DHT dht(DHT_PIN, DHT_TYPE);
Servo feeder;

int temperature = 0, humidity = 0, lightLevel = 0, ledBrightness = 0;
int activityCount = 0, heartRate = 80;
bool feeding = false, motionDetected = false, fanOn = false;
unsigned long lastReport = 0, feedTimer = 0;
int tempHigh = 28, humHigh = 75;

void setup() {
  Serial.begin(115200);
  dht.begin(); delay(2000);
  feeder.attach(SERVO_PIN); feeder.write(0);
  pinMode(LED_PIN, OUTPUT); pinMode(PIR_PIN, INPUT); pinMode(FAN_PIN, OUTPUT);
  digitalWrite(FAN_PIN, LOW);
  Serial.println("CPS Pet Care Ready");
}

void loop() {
  unsigned long now = millis();

  if (now - lastReport >= 3000) {
    lastReport = now;
    float t = dht.readTemperature(), h = dht.readHumidity();
    if (!isnan(t) && !isnan(h)) { temperature = (int)t; humidity = (int)h; }
    lightLevel = analogRead(LIGHT_PIN);
    ledBrightness = map(constrain(lightLevel, 0, 4095), 0, 4095, 255, 0);
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
