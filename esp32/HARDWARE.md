# Arondight45 · echte Drohne (ESP32‑S31)

Die Firmware in diesem Ordner ist dieselbe Regelung, die im Spiel (Browser‑SIL) und im
HIL‑Prüfstand läuft. Dieses Blatt beschreibt, was man für den echten 5‑Zoll‑Quad braucht,
wie man ihn verkabelt und wie die Halte‑/Landeautomatik (GAME‑Modus) ihre Sensoren bekommt.

## Was die Firmware kann

| Funktion | Woher | Stand |
|---|---|---|
| Lage‑Regelung (Rate/Winkel), Arming, Failsafe, Watchdog | ICM‑42688‑P (SPI, 1 kHz) | fertig, getestet (Host, HIL, SIL) |
| Fernsteuerung | SBUS (invertiert, 100 kBd) – z. B. ELRS‑Empfänger mit „SBUS“-Ausgang | fertig |
| Motoren | 4× PWM 1000–2000 µs @ 400 Hz (MCPWM) | fertig; ESC muss **PWM** annehmen (AM32 / BLHeli_32) |
| Not‑Aus | `FC_PIN_KILL` (Pull‑up, gegen GND = sofort Motoren aus) | fertig |
| **GAME: Position/Höhe halten, landen** | NAV1‑Lösung (Geschwindigkeit + Höhe + Kurs) | **neu: an Bord berechnet (FlowNav)** |

### FlowNav (neu)

GAME braucht Geschwindigkeit über Grund, Höhe über Grund und einen absoluten Kurs. FlowNav
(`Arondight45_FlowNav.hpp`, eingebaut in `Arondight45_DroneFC_S31.cpp`) baut das aus:

* **MicoAir MTF‑01** (Optical Flow + ToF‑Lidar in einem, 4,5 g): MSP v2 an der NAV‑UART.
  Flow wird mit dem Gyro „entdreht“ und mit der Lidar‑Höhe zu m/s; Höhe = Lidar × cos(Neigung).
* **Kompass QMC5883L oder QMC5883P** (I²C, z. B. aus einem GPS‑Modul oder GY‑271):
  neigungskompensierter Kurs, Hard‑/Soft‑Iron‑Kalibrierung.
* Sicherheit: Ohne kalibrierten Flow, ohne gültige Höhe oder ohne bestätigten Kompass meldet
  FlowNav „ungültig“ → GAME bleibt aus (der Regler fällt auf reine Lagehaltung zurück).
  Steht die Drohne (Lidar < 12 cm), wird 0 m/s gemeldet – so kann sie auf dem Boden armen.
* Ein externes NAV1‑Modul hat immer Vorrang; FlowNav springt nur ein, wenn 0,5 s keines sprach.

## Verkabelung (Standard‑Pins, per `-D` änderbar)

| Signal | ESP32‑S31 GPIO | Gegenstelle |
|---|---|---|
| IMU MOSI / MISO / SCLK / CS / DRDY | 11 / 12 / 13 / 10 / 9 | ICM‑42688‑P (3,3 V!) |
| SBUS | 8 | Empfänger SBUS‑Ausgang |
| NAV RX (MSP v2 / NAV1) | 18 | MTF‑01 TX (5 V‑Versorgung, Signal 3,3 V) |
| Kompass SDA / SCL | 14 / 15 | QMC5883 SDA / SCL (`FC_PIN_MAG_SDA=-1` = kein Kompass) |
| Motor 1–4 | 4 / 5 / 6 / 7 | ESC‑Signal M1–M4 |
| Not‑Aus | `FC_PIN_KILL` (Standard aus) | Schalter nach GND |

* MTF‑01 im MicoAssistant auf **MSP** und **230400 Baud** stellen
  (oder Firmware mit `-DFC_NAV_UART_BAUD=115200` bauen).
* Kompass möglichst weit weg von Motor‑/Akkukabeln (GPS‑Mast). Pfeil nach vorn; sonst
  `FC_MAG_ROTATION` (0/90/180/270) / `FC_MAG_FLIPPED` setzen.
* MTF‑01 nach unten, freie Sicht, nicht vom Akku verdeckt. Lichter Boden mit Struktur
  (Rasen, Pflaster) funktioniert; einfarbiger glatter Boden / Dunkelheit nicht (≥ 60 lux).

## Kalibrieren (einmal, wird im Flash gespeichert)

Alles **unbewaffnet**, Propeller **ab**:

1. **Flow**: Drohne 30–60 cm über strukturiertem Boden in der Hand halten und ~20 s um Rollen‑ und
   Nickachse kippeln (je ±20–30°). FlowNav lernt Maßstab, Einbaulage und Spiegelung des Sensors
   (Log: `FlowNav calibration stored: flow=1 …`).
2. **Kompass**: Drohne einmal komplett um alle drei Achsen drehen (wie beim Handy‑Kompass, ~30 s).
3. **Kompass‑Drehsinn**: Drohne flach 2× langsam um die Hochachse drehen. Erst wenn Kompass und
   Gyro übereinstimmen, wird der Kurs benutzt (falscher Drehsinn würde die Gierregelung aufschaukeln).
4. Neu kalibrieren: Firmware einmal mit `-DFC_FLOWNAV_RESET=1` flashen, danach wieder ohne.

Konfiguration: `FC_FLOW_MIN_QUALITY` (60/255), `FC_FLOW_MAX_AGL_CM` (600), `FC_RANGE_MAX_CM`
(780; MTF‑01P: 1150), `FC_LANDED_AGL_CM` (12), `FC_MAG_DECLINATION_CDEG` (350 = +3,5° Bodensee).

## Erstflug – Reihenfolge

1. Smoke‑Stopper, Strom ohne Propeller: Log prüfen (`compass QMC5883L at 0x0d`, kein Fault).
2. Motor‑Reihenfolge und Drehrichtung ohne Propeller testen.
3. Kalibrieren (oben). Not‑Aus testen.
4. Erst Lage‑Modus (GAME aus) im Freien, 1–2 m. Dann GAME über Rasen, 1–3 m Höhe.
5. Akku nicht leerfliegen: die Firmware misst die Akkuspannung noch nicht → Timer 3 min.

## Noch offen (bewusst)

* Akkuspannungsmessung + automatisches Landen bei Unterspannung (braucht ADC‑Teiler + SIL‑Modell).
* DShot statt PWM (RMT), Blackbox‑Log im Flash, GPS‑Position für große Höhen (> 6 m).

Tests: `tests/flow_nav_test.cpp` (MSP, Flow‑Kalibrierung, Entdrehung, Lidar, Kompass,
Drehsinn, NAV1‑Rundweg) laufen in CI mit gcc, clang und ASan/UBSan; der ESP‑IDF‑Build für
den S31 läuft in `s31-hil.yml`.
