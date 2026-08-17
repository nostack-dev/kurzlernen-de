# ESP32-S31 / real-airframe digital-twin audit

Audit date: 2026-08-15

## Verdict

The repository has a strong **shared flight-software twin**, but it does **not** yet have a 1:1 ESP32-S31 or real-airframe twin.

`sim/Arondight45_DroneFC_SIL_WASM.cpp`, functional S31 HIL and production firmware all execute the same `fc::FirmwareRuntime → fc::StateRuntime → fc::Runtime` source and the same raw ICM/SBUS/NAV1 protocol boundary. That proves controller semantics and wire contracts. It does not prove RISC-V instruction timing, ESP-IDF scheduling, SPI/UART/MCPWM interrupt behavior, the physical sensors, ESCs, motors, props, battery, frame, airflow or terrain.

The official [ESP32-S31 datasheet](https://documentation.espressif.com/esp32-s31_datasheet_en.html) is currently pre-release v0.5 (2026-07-13), and Espressif labels the latest [ESP-IDF S31 documentation](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s31/get-started/index.html) as continually developed. The target is a real ESP32-S31, not an ESP32-S3 alias: S31 is a dual-core 32-bit RISC-V SoC, whereas S3 is Xtensa. The build guard `CONFIG_IDF_TARGET_ESP32S31` and `idf.py --preview set-target esp32s31` correctly prevent an S3 substitution.

## What is and is not twinned

| Layer | Current evidence | Status |
|---|---|---|
| Flight-control algorithms | One shared C++ source; host, Clang, WASM protocol and state-control tests | Source/semantic twin |
| Raw sensor/control boundary | Same 14-byte ICM register image, 25-byte SBUS and CRC-protected NAV1 frames | Contract twin |
| ESP32-S31 compilation | Production and HIL compile in pinned Espressif ESP-IDF image for `esp32s31` | Compile proof only |
| Physical S31 execution | Functional HIL runs shared runtime on an S31 and returns ESC pulses | Functional MCU proof; board run still required |
| Production timing | Production uses ICM DRDY → pinned high-priority task → SPI read → runtime → MCPWM | Implemented, not measured in this repository |
| SIL timing | Browser executes deterministic 1 ms steps through a wall-time scheduler | Simulation timing, not MCU cycles/interrupt latency |
| IMU | ICM-42688-P ranges/noise/bias are approximated in JavaScript | Unvalidated sensor model |
| Motor/ESC/prop | Lumped Kv/R/J, constant Ct/Cq and simple advance/ground-effect terms | Unvalidated plant model |
| Battery | OCV + scalar internal resistance + charge integration | Unvalidated electrical/thermal model |
| Airframe | Box3D rigid body with configured mass/inertia and simple quadratic drag | Unvalidated aerodynamic/structural model |
| REAL WORLD map | WGS84 origin, aerial imagery and OpenStreetMap/OpenFreeMap context | Geospatial adapter, source accuracy unvalidated |
| Terrain/building physics | Flat local `z=0`; nearby loaded OSM footprints/heights become bounded static Box3D prisms with roof range hits | Implemented approximation; not surveyed/validated world truth |

## S31-specific review

Production firmware has the right structural boundary:

- `Arondight45_DroneFC_S31.cpp` refuses non-S31 targets at compile time.
- ICM-42688-P is sampled over 10 MHz SPI from the DRDY-notified flight task. WHO_AM_I and written configuration registers are checked.
- SBUS uses 100000 baud, 8E2 and inverted RX; NAV1 has its own UART parser and reaches `FirmwareRuntime` undecoded.
- Four MCPWM outputs use a 1 MHz timer and a 2500 μs period (400 Hz), with compare updates on timer-empty.
- Missed DRDY notifications, IMU timeout, controller faults, heartbeat timeout, watchdog and optional hardware kill all fail closed.

Still missing before “1a”:

1. Run production and HIL images on the exact PCB/S31 revision and record chip revision, ESP-IDF commit, clocks and configuration.
2. Logic-analyzer evidence for DRDY-to-SPI-start, SPI completion, controller completion and MCPWM-update latency/jitter under Wi-Fi/USB/UART load.
3. Oscilloscope comparison of commanded versus physical ESC pulses on all four outputs, including arming, fault, reboot and watchdog paths.
4. ICM-42688-P temperature, vibration, mounting rotation, filter and timestamp characterization. TDK specifies selectable ranges and filters, but the browser approximation is not evidence for a particular board. See the official [ICM-42688-P product/datasheet page](https://www.invensense.tdk.com/en-us/products/consumer/icm-42688-p).
5. Review the applicable [ESP32-S31 errata](https://documentation.espressif.com/esp-chip-errata/en/latest/esp32s31/esp-chip-errata-en-master-esp32s31.pdf) for the actual silicon revision and supply/flash configuration.

## Real-airframe acceptance path

Do not add more guessed coefficients and call that “more real.” Measure the exact airframe:

1. Mass, center of gravity and full inertia tensor with measurement uncertainty.
2. Motor/prop dynamometer maps versus voltage, RPM, axial and cross-flow velocity; ESC command delay, current limiting and braking.
3. Battery OCV/SOC, pulse resistance, capacity, temperature and voltage/current sensor calibration.
4. IMU bias/noise/allan variance, axis alignment, temperature drift, vibration spectrum, filters and end-to-end latency.
5. Timestamped flight logs containing all four motor pulses, position, velocity, attitude, battery voltage and current across hover, collective steps, roll/pitch/yaw excitation and the intended 10–25 m/s envelope.
6. Identify parameters on the first 70% of each ordered log and pass the untouched final 30% against `sim/physics_validation.mjs` physical-unit gates. Repeat on independent flights, payloads, batteries, wind and temperature. A single split is the minimum gate, not final certification.
7. Validate OSM building footprints/heights against surveyed structures and add verified terrain elevation/material data before treating REAL WORLD collision or ground height as physical world truth.

Until those measurements exist, the correct UI state is `UNVALIDATED`. `HOLDOUT VALIDATED` means only that the current parameter set passed the recorded acceptance limits inside the measured flight envelope; it is not a universal or exact-physics claim.
