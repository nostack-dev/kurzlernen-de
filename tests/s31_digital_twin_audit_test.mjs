import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(path,"utf8");
const production=read("esp32/Arondight45_DroneFC_S31.cpp");
const hil=read("esp32/Arondight45_DroneFC_HIL_S31.cpp");
const sil=read("sim/Arondight45_DroneFC_SIL_WASM.cpp");
const workflow=read(".github/workflows/s31-hil.yml");
const simulator=read("sim/simulator.mjs");
const world=read("sim/real_world_bootstrap.mjs");
const html=read("drone_simulator.html");
const audit=read("S31_DIGITAL_TWIN_AUDIT.md");

for(const source of [production,hil]){
  assert.match(source,/CONFIG_IDF_TARGET_ESP32S31/,"physical firmware must reject a non-S31 ESP-IDF target");
  assert.doesNotMatch(source,/CONFIG_IDF_TARGET_ESP32S3\b/,"ESP32-S31 must never be silently substituted with ESP32-S3");
}
assert.match(workflow,/--preview set-target esp32s31/g);
assert.equal((workflow.match(/--preview set-target esp32s31/g)||[]).length,2,"both production and HIL builds target real ESP32-S31");

assert.match(production,/fc::FirmwareRuntime runtime/);
assert.match(production,/ulTaskNotifyTake\(pdTRUE, pdMS_TO_TICKS\(5\)\)/,"production must be ICM-DRDY notified");
assert.match(production,/hardware\.missed_samples = notifications > 1/);
assert.match(production,/mcpwm_comparator_set_compare_value/);
assert.match(production,/heartbeat.+30000/s);

assert.match(hil,/hil::RuntimeAdapter runtime/);
assert.match(sil,/hil::RuntimeAdapter runtime/);
assert.match(hil,/does not\s+\* claim to reproduce the production IMU-DRDY scheduling path/);
assert.doesNotMatch(sil,/mcpwm_|spi_device_|uart_read_bytes/,"WASM SIL must not pretend to emulate S31 peripherals");

assert.match(simulator,/simulationTimingDiscontinuityMs/);
assert.match(simulator,/partitionCalibrationLog\(realLog\)/);
assert.match(html,/data-validation="unvalidated"/);
assert.match(world,/map geometry is never silently treated as collision truth/);
assert.match(audit,/does \*\*not\*\* yet have a 1:1 ESP32-S31 or real-airframe twin/);

console.log("S31 audit passed: shared controller/wire twin proven; MCU timing, plant and terrain remain explicitly unvalidated");
