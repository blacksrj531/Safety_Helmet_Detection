#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>

// ======================== PIN DEFINITIONS ========================
const int SERVO_PIN = 18;          // TowerPro MG90S PWM Control Pin
const int STATUS_LED_PIN = 2;       // On-board Blue LED (GPIO 2)

// ======================== SERVO SETTINGS ========================
Servo helmetServo;
const int SERVO_OFF_ANGLE = 0;     // No Helmet detected (Switch OFF)
const int SERVO_ON_ANGLE = 90;     // Helmet detected (Switch ON)
int currentServoAngle = SERVO_OFF_ANGLE;

// ======================== WIFI CONFIG ========================
// Mode 1: Access Point (AP) mode - ESP32 hosts its own WiFi network
// Phone or PC connects directly to this WiFi. No router required!
const char* ap_ssid = "SmartHelmet_AP";
const char* ap_pass = "helmet1234";

// Optional: Station Mode (Uncomment & fill if you want ESP32 to join home router)
// const char* sta_ssid = "YOUR_WIFI_SSID";
// const char* sta_pass = "YOUR_WIFI_PASSWORD";

WebServer server(80);

// ======================== HELPER FUNCTIONS ========================
void setServoState(bool helmetDetected) {
  if (helmetDetected) {
    currentServoAngle = SERVO_ON_ANGLE;
    helmetServo.write(SERVO_ON_ANGLE);
    digitalWrite(STATUS_LED_PIN, HIGH);
    Serial.println("[ESP32] HELMET DETECTED -> Trigger ON (Servo at 90 deg)");
  } else {
    currentServoAngle = SERVO_OFF_ANGLE;
    helmetServo.write(SERVO_OFF_ANGLE);
    digitalWrite(STATUS_LED_PIN, LOW);
    Serial.println("[ESP32] NO HELMET -> Trigger OFF (Servo at 0 deg)");
  }
}

// Enable CORS headers so Web App / Android WebView can make AJAX requests freely
void sendCORSHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
}

void handleOptions() {
  sendCORSHeaders();
  server.send(204);
}

void handleTrigger() {
  sendCORSHeaders();
  if (server.hasArg("state")) {
    String state = server.arg("state");
    state.toLowerCase();
    if (state == "on" || state == "1" || state == "helmet") {
      setServoState(true);
      server.send(200, "application/json", "{\"status\":\"success\",\"trigger\":\"ON\",\"angle\":" + String(currentServoAngle) + "}");
      return;
    } else if (state == "off" || state == "0" || state == "no_helmet") {
      setServoState(false);
      server.send(200, "application/json", "{\"status\":\"success\",\"trigger\":\"OFF\",\"angle\":" + String(currentServoAngle) + "}");
      return;
    }
  }
  server.send(400, "application/json", "{\"error\":\"Missing or invalid 'state' argument. Use state=on or state=off\"}");
}

void handleStatus() {
  sendCORSHeaders();
  String json = "{\"device\":\"Smart_Safety_Helmet_ESP32\",";
  json += "\"pin\":" + String(SERVO_PIN) + ",";
  json += "\"servo_angle\":" + String(currentServoAngle) + ",";
  json += "\"status\":\"" + String(currentServoAngle == SERVO_ON_ANGLE ? "HELMET_ON" : "HELMET_OFF") + "\"}";
  server.send(200, "application/json", json);
}

void handleRoot() {
  sendCORSHeaders();
  String html = "<!DOCTYPE html><html><head><title>ESP32 Helmet Servo Controller</title>";
  html += "<meta name='viewport' content='width=device-width, initial-scale=1'>";
  html += "<style>body{font-family:sans-serif;text-align:center;padding:20px;background:#0f172a;color:#f8fafc;}";
  html += ".btn{padding:15px 30px;font-size:18px;margin:10px;border-radius:8px;border:none;cursor:pointer;font-weight:bold;}";
  html += ".btn-on{background:#22c55e;color:white;}.btn-off{background:#ef4444;color:white;}</style></head><body>";
  html += "<h2>Smart Helmet ESP32 Trigger Hub</h2>";
  html += "<p>MG90S Servo Pin: <b>GPIO 18</b></p>";
  html += "<p>Current Angle: <b>" + String(currentServoAngle) + "&deg;</b></p>";
  html += "<a href='/trigger?state=on'><button class='btn btn-on'>TEST ON (90&deg;)</button></a>";
  html += "<a href='/trigger?state=off'><button class='btn btn-off'>TEST OFF (0&deg;)</button></a>";
  html += "</body></html>";
  server.send(200, "text/html", html);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n--- Smart Safety Helmet ESP32 Controller Booting ---");

  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  // Initialize Servo
  // Standard TowerPro MG90S 50Hz, 500us to 2400us pulse
  helmetServo.setPeriodHertz(50);
  helmetServo.attach(SERVO_PIN, 500, 2400);
  helmetServo.write(SERVO_OFF_ANGLE);

  // Setup WiFi Access Point Mode
  WiFi.mode(WIFI_AP);
  WiFi.softAP(ap_ssid, ap_pass);
  IPAddress IP = WiFi.softAPIP();

  Serial.print("ESP32 AP SSID: ");
  Serial.println(ap_ssid);
  Serial.print("ESP32 AP IP Address: ");
  Serial.println(IP); // Typically 192.168.4.1

  // Web Server Routes
  server.on("/", HTTP_GET, handleRoot);
  server.on("/trigger", HTTP_GET, handleTrigger);
  server.on("/trigger", HTTP_OPTIONS, handleOptions);
  server.on("/status", HTTP_GET, handleStatus);
  server.on("/status", HTTP_OPTIONS, handleOptions);

  server.begin();
  Serial.println("HTTP Server started successfully!");
  Serial.println("Ready to receive Helmet Trigger commands via HTTP or USB Serial (send 'ON' or 'OFF').\n");
}

void loop() {
  server.handleClient();

  // Also support USB Serial direct triggers!
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    cmd.toUpperCase();
    if (cmd == "ON" || cmd == "HELMET") {
      setServoState(true);
    } else if (cmd == "OFF" || cmd == "NO_HELMET") {
      setServoState(false);
    }
  }
}
