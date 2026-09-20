// SideQuests wearable (ESP32). See docs/firmware-protocol.md.
//
// Three jobs:
//   1. BLE peripheral for ITS OWN phone: serves this wearable's token (read) and notifies
//      "NEAR:<peer-token>:<rssi>" / "IDLE" on the match characteristic.
//   2. BLE observer of OTHER wearables: each advertises its token in manufacturer data, so we can
//      report exactly WHO is nearby. No phone or server is involved in that exchange.
//   3. Wi-Fi AP + UDP status feed for this unit's Arduino UNO R4 display.
//
// One unit per person. The only thing to change per unit is AP_SSID below (so each UNO joins its own
// ESP32). The BLE token is derived from the chip's MAC, so every board is automatically unique.

#include <Adafruit_NeoPixel.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEScan.h>
#include <BLEAdvertising.h>
#include <BLECharacteristic.h>
#include <BLE2902.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <esp_mac.h>
#include <Preferences.h>

// ---- PINS ----
#define LED_PIN     5
#define NUM_LEDS    7
#define BUZZER_PIN  4

// ---- MATCH TUNING (radios and bodies differ; tune these on the real wearables) ----
// A peer counts as "near" at ENTER and stays near until it is weaker than EXIT or unseen for LOST_MS.
// The gap between ENTER and EXIT is hysteresis: without it a peer hovering at the edge flaps on/off.
// Defaults only: the display's menu can change these at runtime and they are saved to flash.
static const int  RSSI_ENTER_DEFAULT = -60;  // ~1-3 m with these boards
static const int  RSSI_EXIT_MARGIN   = 12;   // exit threshold sits this far below enter
// Clamps, so a curious user can't set a range that breaks matching (never matches / matches the whole room).
static const int  RSSI_ENTER_MIN = -85;
static const int  RSSI_ENTER_MAX = -40;
static const unsigned long LOST_MS        = 6000;   // no advert seen for this long -> peer left
static const unsigned long NEAR_REPEAT_MS = 10000;  // re-notify a still-present peer at most this often
static const int  SCAN_SECONDS = 1;
// A peer must be seen this many separate scans before it counts. One stray advert - a reflection, or a
// radio reporting a bogus RSSI - is not an encounter.
static const uint8_t CONFIRM_HITS = 2;
// Sanity range for a real reading. Some scans report 0 or 127 for "unknown", and 0 sails past any
// "is it strong enough" test, which is what makes a board 60 m away look like it is right next to you.
static const int RSSI_MIN_VALID = -99;
static const int RSSI_MAX_VALID = -25;

// ---- BLE IDs (must match mobile/src/services/ble.ts) ----
#define PHONE_SERVICE_UUID "abcd1234-1234-1234-1234-abcdef123456"
#define MATCH_CHAR_UUID    "abcd1234-1234-1234-1234-abcdef123457" // notify: NEAR:<token>:<rssi> | IDLE
#define TOKEN_CHAR_UUID    "abcd1234-1234-1234-1234-abcdef123458" // read: our own token
#define STATE_CHAR_UUID    "abcd1234-1234-1234-1234-abcdef123459" // write: NONE|CANDIDATE|WAITING|MATCHED from the phone
static const char* BLE_NAME = "PassingStranger";                  // the app finds its wearable by this name

// Wearable-to-wearable advert: manufacturer data = FF FF 'S' 'Q' '1' <token>.
// 0xFFFF is the "no registered company" id, fine for a hackathon; the magic keeps us from reading
// some unrelated device's manufacturer bytes as a token.
static const char* MAGIC = "SQ1";
static const uint8_t MAGIC_LEN = 3;

// ---- Wi-Fi AP for this unit's UNO R4 display. CHANGE PER UNIT: -1, -2, -3... ----
static const char* AP_SSID = "PassingStranger-1";
static const char* AP_PASS = "hackthenorth";
static const uint16_t UDP_LOCAL_PORT = 4210;  // we listen here for the UNO's HELLO
static const uint16_t UDP_UNO_PORT   = 4211;  // the UNO listens here for our status
static const unsigned long STATUS_MS = 1000;

// arduino-esp32 3.x switched these BLE APIs from std::string to Arduino String.
#if defined(ESP_ARDUINO_VERSION) && ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
typedef String BleStr;
#else
typedef std::string BleStr;
#endif

Adafruit_NeoPixel pixel(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);
WiFiUDP udp;
BLEScan* pBLEScan = nullptr;
BLECharacteristic* matchChar = nullptr;
BLECharacteristic* tokenChar = nullptr;
BLECharacteristic* stateChar = nullptr;
Preferences prefs;

// ---- settings the display's menu owns (persisted) ----
int  rssiEnter = RSSI_ENTER_DEFAULT;
int  ledBrightness = 50;   // 10..100
bool buzzerOn = true;
int  rssiExit() { return rssiEnter - RSSI_EXIT_MARGIN; }

// What the phone is showing, so the display can prompt and its buttons can answer.
enum MatchState { MS_NONE = 0, MS_CANDIDATE = 1, MS_WAITING = 2, MS_MATCHED = 3 };
volatile int matchState = MS_NONE;
uint16_t encounters = 0;   // confirmed people met since boot; shown in the display's INFO screen

char myToken[16];                  // "PS" + 12 hex MAC chars: unique per board, stable across reboots
volatile bool phoneConnected = false;
IPAddress unoIP;
bool unoConnected = false;

// ---- peers currently in range ----
struct Peer {
  char token[24];
  int  rssi;          // smoothed, so one odd reading can't trigger or drop an encounter
  uint8_t hits;       // scans this peer has been seen in
  bool confirmed;     // reported to the phone / counted on the display
  unsigned long lastSeen;
  unsigned long lastNotified;
};
static const uint8_t MAX_PEERS = 8;
Peer peers[MAX_PEERS];
uint8_t peerCount = 0;

// Advertising stops on connect by default, which would hide us from other wearables exactly when our
// own phone is listening. Restart it on both edges.
void saveSettings() {
  prefs.putInt("enter", rssiEnter);
  prefs.putInt("bright", ledBrightness);
  prefs.putBool("buzz", buzzerOn);
}

void loadSettings() {
  prefs.begin("sidequests", false);
  rssiEnter = prefs.getInt("enter", RSSI_ENTER_DEFAULT);
  ledBrightness = prefs.getInt("bright", 50);
  buzzerOn = prefs.getBool("buzz", true);
  if (rssiEnter < RSSI_ENTER_MIN || rssiEnter > RSSI_ENTER_MAX) rssiEnter = RSSI_ENTER_DEFAULT;
  if (ledBrightness < 10 || ledBrightness > 100) ledBrightness = 50;
}

// The phone writes what it is showing, so the display knows when to offer Wave / Not now.
class StateCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String v = String(c->getValue().c_str());
    v.trim();
    if (v == "CANDIDATE") matchState = MS_CANDIDATE;
    else if (v == "WAITING") matchState = MS_WAITING;
    else if (v == "MATCHED") matchState = MS_MATCHED;
    else matchState = MS_NONE;
    Serial.printf("Phone state: %s\n", v.c_str());
  }
};

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    phoneConnected = true;
    BLEDevice::startAdvertising();
  }
  void onDisconnect(BLEServer*) override {
    phoneConnected = false;
    matchState = MS_NONE;      // no phone, nothing to answer
    BLEDevice::startAdvertising();
  }
};

void makeToken() {
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);  // factory ID: same value on every boot
  snprintf(myToken, sizeof(myToken), "PS%02X%02X%02X%02X%02X%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

void startAdvertising() {
  // Advert (31 bytes max): flags + manufacturer data carrying our token, for other wearables.
  BleStr mfg;
  mfg += (char)0xFF;
  mfg += (char)0xFF;
  mfg += MAGIC;
  mfg += myToken;

  BLEAdvertisementData advData;
  advData.setFlags(0x06);  // LE General Discoverable, BR/EDR not supported
  advData.setManufacturerData(mfg);

  // Scan response: the name the phone app looks for. It does not fit beside the manufacturer data.
  BLEAdvertisementData scanData;
  scanData.setName(BLE_NAME);

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->setAdvertisementData(advData);
  adv->setScanResponseData(scanData);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
}

void notifyPhone(const char* msg) {
  if (!phoneConnected || !matchChar) return;
  matchChar->setValue((uint8_t*)msg, strlen(msg));
  matchChar->notify();
}

void beep(uint16_t ms) {
  if (!buzzerOn) return;       // silent mode, from the display's menu
  digitalWrite(BUZZER_PIN, HIGH);
  delay(ms);
  digitalWrite(BUZZER_PIN, LOW);
}

int findPeer(const char* token) {
  for (uint8_t i = 0; i < peerCount; i++) {
    if (strcmp(peers[i].token, token) == 0) return i;
  }
  return -1;
}

void removePeer(uint8_t i) {
  peers[i] = peers[peerCount - 1];
  peerCount--;
}

// Pulls a peer token out of an advert's manufacturer data, or returns false if this isn't one of ours.
bool peerTokenFrom(BLEAdvertisedDevice& d, char* out, size_t outSize) {
  if (!d.haveManufacturerData()) return false;
  auto md = d.getManufacturerData();
  const size_t header = 2 + MAGIC_LEN;
  if (md.length() <= header) return false;
  if (memcmp(md.c_str() + 2, MAGIC, MAGIC_LEN) != 0) return false;

  size_t len = md.length() - header;
  if (len >= outSize) len = outSize - 1;
  memcpy(out, md.c_str() + header, len);
  out[len] = '\0';
  return strcmp(out, myToken) != 0;  // never report ourselves
}

void seePeer(const char* token, int rssi) {
  if (rssi > RSSI_MAX_VALID || rssi < RSSI_MIN_VALID) return;  // 0 / 127 / nonsense: no reading at all
  unsigned long now = millis();
  int i = findPeer(token);

  if (i < 0) {
    if (rssi < rssiEnter) return;            // too far to be the start of an encounter
    if (peerCount >= MAX_PEERS) return;
    i = peerCount++;
    strncpy(peers[i].token, token, sizeof(peers[i].token) - 1);
    peers[i].token[sizeof(peers[i].token) - 1] = '\0';
    peers[i].rssi = rssi;
    peers[i].hits = 0;
    peers[i].confirmed = false;
    peers[i].lastNotified = 0;
  }
  // Weighted average: reacts in a couple of scans, ignores a single spike.
  peers[i].rssi = (peers[i].rssi * 2 + rssi) / 3;
  peers[i].lastSeen = now;
  if (peers[i].hits < 255) peers[i].hits++;

  if (!peers[i].confirmed) {
    if (peers[i].hits < CONFIRM_HITS || peers[i].rssi < rssiEnter) return;  // not an encounter yet
    peers[i].confirmed = true;
    if (encounters < 9999) encounters++;
    beep(120);                               // a new person, not a repeat
  }

  // Notify on arrival, then at most every NEAR_REPEAT_MS while they stay (the app also rate-limits).
  if (peers[i].lastNotified == 0 || now - peers[i].lastNotified >= NEAR_REPEAT_MS) {
    peers[i].lastNotified = now;
    char msg[48];
    snprintf(msg, sizeof(msg), "NEAR:%s:%d", peers[i].token, peers[i].rssi);
    notifyPhone(msg);
    Serial.println(msg);
  }
}

// Only confirmed peers are shown or reported; unconfirmed ones are still being judged.
uint8_t confirmedCount() {
  uint8_t n = 0;
  for (uint8_t i = 0; i < peerCount; i++) if (peers[i].confirmed) n++;
  return n;
}

// Drops peers that went quiet or faded below the exit threshold. Returns true if any were dropped.
bool expirePeers() {
  bool dropped = false;
  unsigned long now = millis();
  for (int i = peerCount - 1; i >= 0; i--) {
    if (now - peers[i].lastSeen > LOST_MS || peers[i].rssi <= rssiExit()) {
      if (peers[i].confirmed) {
        Serial.printf("Lost %s\n", peers[i].token);
        dropped = true;
      }
      removePeer(i);
    }
  }
  return dropped;
}

int bestRssi() {
  int best = -127;
  for (uint8_t i = 0; i < peerCount; i++) {
    if (peers[i].confirmed && peers[i].rssi > best) best = peers[i].rssi;
  }
  return best;
}

// ---- UNO R4 display link ----
void sendToUno(const char* msg) {
  if (!unoConnected) return;
  udp.beginPacket(unoIP, UDP_UNO_PORT);
  udp.print(msg);
  udp.endPacket();
}

int clampInt(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Commands from the display. Settings are clamped here as well as on the UNO: the wearable must stay
// sane even if the display is reflashed with something else.
void handleCommand(const char* cmd) {
  if (strcmp(cmd, "HELLO") == 0) {          // sent at UNO boot and as a keepalive
    unoIP = udp.remoteIP();
    unoConnected = true;
    char info[48];
    snprintf(info, sizeof(info), "I:%s", myToken);
    sendToUno(info);                        // the display's INFO screen shows our token
    Serial.print("UNO at ");
    Serial.println(unoIP);
    return;
  }

  // Wave / Not now pressed on the display. Only meaningful while the phone says a candidate is open;
  // the app ignores them otherwise, but not sending is cheaper than being ignored.
  if (strcmp(cmd, "WAVE") == 0 || strcmp(cmd, "PASS") == 0) {
    if (matchState == MS_CANDIDATE) {
      notifyPhone(cmd);
      Serial.printf("Button: %s\n", cmd);
    }
    return;
  }

  int value = 0;
  if (sscanf(cmd, "SET:ENTER:%d", &value) == 1) {
    rssiEnter = clampInt(value, RSSI_ENTER_MIN, RSSI_ENTER_MAX);
    saveSettings();
    Serial.printf("Range now %d dBm (leave at %d)\n", rssiEnter, rssiExit());
  } else if (sscanf(cmd, "SET:BRIGHT:%d", &value) == 1) {
    ledBrightness = clampInt(value, 10, 100);
    pixel.setBrightness(map(ledBrightness, 0, 100, 0, 255));
    saveSettings();
  } else if (sscanf(cmd, "SET:BUZZ:%d", &value) == 1) {
    buzzerOn = value != 0;
    saveSettings();
  }
}

void pumpUno() {
  int size = udp.parsePacket();
  if (size <= 0) return;
  char buf[48];
  int len = udp.read(buf, sizeof(buf) - 1);
  if (len <= 0) return;
  buf[len] = '\0';
  handleCommand(buf);
}

// One line the display can render without asking anything back:
// S:<phone linked>:<peers near>:<best rssi>:<match state>:<range>:<brightness>:<buzzer>:<encounters>
void sendStatus() {
  char msg[64];
  uint8_t near = confirmedCount();
  snprintf(msg, sizeof(msg), "S:%d:%d:%d:%d:%d:%d:%d:%u",
           phoneConnected ? 1 : 0, near, near ? bestRssi() : 0, matchState,
           rssiEnter, ledBrightness, buzzerOn ? 1 : 0, encounters);
  sendToUno(msg);
}

// ---- LEDs ----
uint32_t wheel(uint8_t pos) {
  if (pos < 85) return pixel.Color(255 - pos * 3, pos * 3, 0);
  if (pos < 170) { pos -= 85; return pixel.Color(0, 255 - pos * 3, pos * 3); }
  pos -= 170;
  return pixel.Color(pos * 3, 0, 255 - pos * 3);
}

void paint() {
  static uint8_t step = 0;
  if (confirmedCount() > 0) {
    for (int i = 0; i < NUM_LEDS; i++) pixel.setPixelColor(i, wheel(step + i * 12));  // rainbow: someone is near
    step += 6;
  } else if (phoneConnected) {
    for (int i = 0; i < NUM_LEDS; i++) pixel.setPixelColor(i, 0);
    pixel.setPixelColor(0, pixel.Color(0, 24, 0));   // dim green: linked, scanning, nobody yet
  } else {
    for (int i = 0; i < NUM_LEDS; i++) pixel.setPixelColor(i, 0);
    pixel.setPixelColor(0, pixel.Color(24, 12, 0));  // dim amber: waiting for the phone
  }
  pixel.show();
}

void setup() {
  Serial.begin(115200);

  loadSettings();

  pixel.begin();
  pixel.setBrightness(map(ledBrightness, 0, 100, 0, 255));
  pixel.clear();
  pixel.show();

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  makeToken();
  Serial.printf("Wearable token: %s\n", myToken);

  WiFi.softAP(AP_SSID, AP_PASS);
  udp.begin(UDP_LOCAL_PORT);
  Serial.print("AP ");
  Serial.print(AP_SSID);
  Serial.print(" at ");
  Serial.println(WiFi.softAPIP());

  BLEDevice::init(BLE_NAME);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(PHONE_SERVICE_UUID);
  matchChar = service->createCharacteristic(
    MATCH_CHAR_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  matchChar->addDescriptor(new BLE2902());
  matchChar->setValue((uint8_t*)"IDLE", 4);

  // The phone reads this once when it links, and sends it to the server as this account's wearable.
  tokenChar = service->createCharacteristic(TOKEN_CHAR_UUID, BLECharacteristic::PROPERTY_READ);
  tokenChar->setValue((uint8_t*)myToken, strlen(myToken));

  // The phone mirrors its match state here, which is what turns the display into a Wave / Not now prompt.
  stateChar = service->createCharacteristic(STATE_CHAR_UUID, BLECharacteristic::PROPERTY_WRITE);
  stateChar->setCallbacks(new StateCallbacks());
  service->start();

  startAdvertising();

  pBLEScan = BLEDevice::getScan();
  pBLEScan->setActiveScan(true);   // also pulls scan responses
  pBLEScan->setInterval(100);
  pBLEScan->setWindow(99);

  Serial.println("Ready.");
}

void loop() {
  pumpUno();

  BLEScanResults* found = pBLEScan->start(SCAN_SECONDS, false);
  char token[24];
  for (int i = 0; i < found->getCount(); i++) {
    BLEAdvertisedDevice d = found->getDevice(i);
    if (peerTokenFrom(d, token, sizeof(token))) seePeer(token, d.getRSSI());
  }
  pBLEScan->clearResults();

  uint8_t before = confirmedCount();
  if (expirePeers() && confirmedCount() == 0 && before > 0) {
    notifyPhone("IDLE");                      // the app stops treating us as "someone nearby"
    Serial.println("IDLE");
  }

  paint();

  static unsigned long lastStatus = 0;
  if (millis() - lastStatus >= STATUS_MS) {
    lastStatus = millis();
    sendStatus();
  }
}
