// SideQuests display (Arduino UNO R4 WiFi + 16x2 LCD keypad shield).
//
// Joins its own ESP32 wearable's Wi-Fi AP over UDP. Two jobs:
//   1. Shows what the wearable is doing, and when the phone has a pending match it becomes a prompt:
//      UP = wave, DOWN = not now. The wearable forwards that to the phone, which answers the server,
//      so the match screen in the app resolves exactly as if the buttons there had been tapped.
//   2. A small settings menu (SELECT) for things the app does not expose: matching range, LED
//      brightness, buzzer. The wearable clamps and saves them, so they survive a reboot.
//
// Messages from the wearable:
//   S:<phone>:<peers>:<rssi>:<match 0-3>:<range>:<bright>:<buzz>:<encounters>
//   I:<token>
// Messages to the wearable: HELLO | WAVE | PASS | SET:ENTER:<dBm> | SET:BRIGHT:<pct> | SET:BUZZ:<0|1>
//
// One unit per person: set AP_SSID to the same value as its ESP32's AP_SSID (-1, -2, -3...).

#include <WiFiS3.h>
#include <WiFiUdp.h>
#include <LiquidCrystal.h>

static const char* AP_SSID = "PassingStranger-1";  // CHANGE PER UNIT, must match its ESP32
static const char* AP_PASS = "hackthenorth";

static const uint16_t UDP_LOCAL_PORT = 4211;   // the wearable sends status here
static const uint16_t UDP_ESP_PORT   = 4210;   // the wearable listens here for commands
static const IPAddress ESP_IP(192, 168, 4, 1); // the ESP32's softAP address

static const unsigned long HELLO_MS   = 5000;  // keepalive, so a rebooted wearable relearns our IP
static const unsigned long STALE_MS   = 5000;  // no status for this long -> assume the link dropped
static const unsigned long FLASH_MS   = 500;
static const unsigned long MENU_IDLE_MS = 15000; // drop back to status, so we never sit in a menu
static const unsigned long DEBOUNCE_MS  = 180;

// Keypad shield buttons sit on one analog pin as a resistor ladder.
// ponytail: these thresholds cover the two common shield variants. Every press prints its raw value to
// Serial, so if a button reads as its neighbour, move the boundary between them to suit your shield.
static const uint8_t BUTTON_PIN = A0;
enum Button { BTN_NONE, BTN_RIGHT, BTN_UP, BTN_DOWN, BTN_LEFT, BTN_SELECT };

// Match state the phone reported, via the wearable.
enum MatchState { MS_NONE = 0, MS_CANDIDATE = 1, MS_WAITING = 2, MS_MATCHED = 3 };

// Limits mirror the wearable's own clamps.
static const int RANGE_MIN = -85, RANGE_MAX = -40, RANGE_STEP = 5;
static const int BRIGHT_MIN = 10, BRIGHT_MAX = 100, BRIGHT_STEP = 10;

WiFiUDP udp;
LiquidCrystal lcd(8, 9, 4, 5, 6, 7);

// ---- last known wearable status ----
bool phoneLinked = false;
int  peerCount = 0;
int  bestRssi = 0;
int  matchState = MS_NONE;
int  range = -60;
int  brightness = 50;
bool buzzer = true;
int  encounters = 0;
char token[24] = "(unknown)";

unsigned long lastStatus = 0, lastHello = 0, lastFlash = 0, lastButton = 0, lastMenuUse = 0;
bool flashOn = true;

enum Screen { SCREEN_STATUS, SCREEN_MENU };
Screen screen = SCREEN_STATUS;
enum MenuItem { MENU_RANGE, MENU_BRIGHT, MENU_BUZZ, MENU_INFO, MENU_COUNT };
int menuItem = MENU_RANGE;

// Writes a whole row padded to 16, so leftovers from a longer line can't stay on screen.
// (Clearing the whole LCD on every update is what made the old version flicker.)
void writeRow(uint8_t row, const char* text) {
  char line[17];
  snprintf(line, sizeof(line), "%-16s", text);
  lcd.setCursor(0, row);
  lcd.print(line);
}

Button readButton() {
  int v = analogRead(BUTTON_PIN);
  if (v < 50) return BTN_RIGHT;
  if (v < 195) return BTN_UP;
  if (v < 380) return BTN_DOWN;
  if (v < 555) return BTN_LEFT;
  if (v < 790) return BTN_SELECT;
  return BTN_NONE;
}

// One event per press: holding a button does not repeat.
Button buttonEvent() {
  static Button last = BTN_NONE;
  int v = analogRead(BUTTON_PIN);
  Button now = readButton();
  if (now == last) return BTN_NONE;
  if (millis() - lastButton < DEBOUNCE_MS) return BTN_NONE;
  lastButton = millis();
  last = now;
  if (now != BTN_NONE) {           // for tuning the thresholds above to your shield
    Serial.print("button ");
    Serial.print(now);
    Serial.print(" raw ");
    Serial.println(v);
  }
  return now;  // BTN_NONE on release, which callers ignore
}

void sendCommand(const char* msg) {
  udp.beginPacket(ESP_IP, UDP_ESP_PORT);
  udp.print(msg);
  udp.endPacket();
}

void sayHello() {
  sendCommand("HELLO");
  lastHello = millis();
}

void sendSetting(const char* key, int value) {
  char msg[32];
  snprintf(msg, sizeof(msg), "SET:%s:%d", key, value);
  sendCommand(msg);
}

void connectWiFi() {
  writeRow(0, "Connecting...");
  writeRow(1, AP_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    WiFi.begin(AP_SSID, AP_PASS);
    for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) {
      delay(500);
      Serial.print('.');
    }
  }
  Serial.println("\nConnected");
  udp.begin(UDP_LOCAL_PORT);
  writeRow(0, "Connected!");
  writeRow(1, "");
  sayHello();
}

void readMessages() {
  int size = udp.parsePacket();
  if (size <= 0) return;
  char buf[64];
  int len = udp.read(buf, sizeof(buf) - 1);
  if (len <= 0) return;
  buf[len] = '\0';

  int phone, peers, rssi, ms, rng, bright, buzz, met;
  if (sscanf(buf, "S:%d:%d:%d:%d:%d:%d:%d:%d",
             &phone, &peers, &rssi, &ms, &rng, &bright, &buzz, &met) == 8) {
    phoneLinked = phone == 1;
    peerCount = peers;
    bestRssi = rssi;
    matchState = ms;
    encounters = met;
    // Settings are owned by the wearable; adopt what it reports so the menu can never drift from it.
    range = rng;
    brightness = bright;
    buzzer = buzz == 1;
    lastStatus = millis();
  } else if (strncmp(buf, "I:", 2) == 0) {
    strncpy(token, buf + 2, sizeof(token) - 1);
    token[sizeof(token) - 1] = '\0';
  }
}

// ---- screens ----

void renderStatus() {
  char top[17], bottom[17];

  if (millis() - lastStatus > STALE_MS) {
    strcpy(top, "No wearable");
    strcpy(bottom, "Check power");
  } else if (matchState == MS_CANDIDATE) {
    // The one screen with a decision on it. Flashing so it is obvious across a room.
    if (flashOn) strcpy(top, "MATCH FOUND!");
    else top[0] = '\0';
    strcpy(bottom, "UP=wave DN=pass");
  } else if (matchState == MS_WAITING) {
    strcpy(top, "Waved!");
    strcpy(bottom, "Waiting on them");
  } else if (matchState == MS_MATCHED) {
    strcpy(top, "It's a match!");
    strcpy(bottom, "Quest in app");
  } else if (peerCount > 0) {
    snprintf(top, sizeof(top), "Nearby: %d", peerCount);
    snprintf(bottom, sizeof(bottom), "Signal %d dBm", bestRssi);
  } else if (phoneLinked) {
    strcpy(top, "Looking...");
    strcpy(bottom, "SEL for menu");
  } else {
    strcpy(top, "Waiting...");
    strcpy(bottom, "Open the app");
  }

  writeRow(0, top);
  writeRow(1, bottom);
}

void renderMenu() {
  char top[17], bottom[17];
  switch (menuItem) {
    case MENU_RANGE:
      strcpy(top, "Range");
      snprintf(bottom, sizeof(bottom), "<%d dBm> %s", range, range >= -50 ? "close" : range >= -65 ? "near" : "room");
      break;
    case MENU_BRIGHT:
      strcpy(top, "LED brightness");
      snprintf(bottom, sizeof(bottom), "<%d%%>", brightness);
      break;
    case MENU_BUZZ:
      strcpy(top, "Buzzer");
      snprintf(bottom, sizeof(bottom), "<%s>", buzzer ? "on" : "silent");
      break;
    default:  // MENU_INFO: not a setting, just things the app never shows
      snprintf(top, sizeof(top), "Met %d today", encounters);
      snprintf(bottom, sizeof(bottom), "%s", token);
      break;
  }
  writeRow(0, top);
  writeRow(1, bottom);
}

void adjust(int dir) {
  lastMenuUse = millis();
  switch (menuItem) {
    case MENU_RANGE:
      // RIGHT (-60 -> -55) demands a stronger signal, so people must be closer to count.
      // LEFT (-60 -> -65) accepts weaker signals, so the bubble reaches further.
      range += dir * RANGE_STEP;
      if (range < RANGE_MIN) range = RANGE_MIN;
      if (range > RANGE_MAX) range = RANGE_MAX;
      sendSetting("ENTER", range);
      break;
    case MENU_BRIGHT:
      brightness += dir * BRIGHT_STEP;
      if (brightness < BRIGHT_MIN) brightness = BRIGHT_MIN;
      if (brightness > BRIGHT_MAX) brightness = BRIGHT_MAX;
      sendSetting("BRIGHT", brightness);
      break;
    case MENU_BUZZ:
      buzzer = !buzzer;
      sendSetting("BUZZ", buzzer ? 1 : 0);
      break;
    default:
      break;  // INFO has nothing to change
  }
}

void handleButton(Button b) {
  if (b == BTN_NONE) return;

  // A pending match always wins: answering someone beats whatever menu is open.
  if (matchState == MS_CANDIDATE) {
    if (b == BTN_UP || b == BTN_DOWN) {
      sendCommand(b == BTN_UP ? "WAVE" : "PASS");
      screen = SCREEN_STATUS;
      writeRow(0, b == BTN_UP ? "Waving..." : "Passed");
      writeRow(1, "");
    }
    return;
  }

  if (screen == SCREEN_STATUS) {
    if (b == BTN_SELECT) {
      screen = SCREEN_MENU;
      menuItem = MENU_RANGE;
      lastMenuUse = millis();
    }
    return;
  }

  // In the menu: UP/DOWN pick an item, LEFT/RIGHT change it, SELECT leaves.
  lastMenuUse = millis();
  if (b == BTN_SELECT) screen = SCREEN_STATUS;
  else if (b == BTN_UP) menuItem = (menuItem + MENU_COUNT - 1) % MENU_COUNT;
  else if (b == BTN_DOWN) menuItem = (menuItem + 1) % MENU_COUNT;
  else if (b == BTN_RIGHT) adjust(1);
  else if (b == BTN_LEFT) adjust(-1);
}

void setup() {
  Serial.begin(115200);
  lcd.begin(16, 2);
  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();

  readMessages();
  handleButton(buttonEvent());

  if (millis() - lastHello >= HELLO_MS) sayHello();

  if (millis() - lastFlash >= FLASH_MS) {
    lastFlash = millis();
    flashOn = !flashOn;
  }

  // Never leave someone stuck in a menu while people walk past.
  if (screen == SCREEN_MENU && millis() - lastMenuUse > MENU_IDLE_MS) screen = SCREEN_STATUS;
  if (matchState == MS_CANDIDATE) screen = SCREEN_STATUS;

  if (screen == SCREEN_MENU) renderMenu();
  else renderStatus();
}
