import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const modulePath = process.argv[2];
if (!modulePath) throw new Error("usage: node tests/sil_wasm_smoke.mjs <flight_core.mjs>");
const { default: createCore } = await import(pathToFileURL(resolve(modulePath)).href);
const core = await createCore();

const INPUT_MAGIC = 0x314c4948;
const OUTPUT_MAGIC = 0x314f4c48;
const FLAG_IMU_VALID = 1;
const FLAG_RESET = 2;
const STATE_ARMED = 1;
const STATE_CALIBRATING = 2;
const STATE_FAULT = 4;

function check(condition, message) {
  if (!condition) throw new Error(`WASM smoke test failed: ${message}`);
}

function crc32(bytes, length = bytes.length) {
  let crc = 0xffffffff;
  for (let i = 0; i < length; ++i) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; ++bit) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeSbus(channels) {
  const p = new Uint8Array(25);
  p[0] = 0x0f;
  for (let channel = 0; channel < 16; ++channel) {
    for (let bit = 0; bit < 11; ++bit) {
      if (channels[channel] & (1 << bit)) {
        const k = 8 + channel * 11 + bit;
        p[k >> 3] |= 1 << (k & 7);
      }
    }
  }
  return p;
}

function packet(sequence, channels, reset = false) {
  const bytes = new Uint8Array(64);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, INPUT_MAGIC, true);
  view.setUint32(4, sequence, true);
  view.setUint32(8, 1000, true);
  bytes[18] = 0x08; // imu_registers[6] => +1g Z at 2048 LSB/g.
  bytes.set(encodeSbus(channels), 26);
  bytes[51] = FLAG_IMU_VALID | (reset ? FLAG_RESET : 0);
  view.setUint32(60, crc32(bytes, 60), true);
  return bytes;
}

function readOutput() {
  const ptr = core._fc_output_buffer();
  const bytes = core.HEAPU8.slice(ptr, ptr + 32);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  check(view.getUint32(0, true) === OUTPUT_MAGIC, "output magic");
  check(crc32(bytes, 28) === view.getUint32(28, true), "output CRC");
  return {
    state: view.getUint16(22, true),
    motors: [view.getUint16(8, true), view.getUint16(10, true), view.getUint16(12, true), view.getUint16(14, true)]
  };
}

function exchange(bytes) {
  core.HEAPU8.set(bytes, core._fc_input_buffer());
  core._fc_process();
  return readOutput();
}

check(core._fc_input_size() === 64, "input size");
check(core._fc_output_size() === 32, "output size");
check(core._fc_protocol_version() === 1, "protocol version");
core._fc_reset();

const channels = new Array(16).fill(992);
channels[2] = 172;
channels[4] = 172;
let output;
for (let i = 0; i < 2001; ++i) output = exchange(packet(i, channels, i === 0));
check((output.state & STATE_CALIBRATING) === 0, "calibration completes");
check((output.state & STATE_FAULT) === 0, "calibration fault-free");

channels[4] = 1811;
for (let i = 0; i < 1002; ++i) output = exchange(packet(3000 + i, channels));
check((output.state & STATE_ARMED) !== 0, "arming");
check(output.motors.every(pulse => pulse === 1050), "armed idle pulse");

channels[2] = 700;
output = exchange(packet(5000, channels));
check(output.motors.every(pulse => pulse > 1050), "throttle output");
console.log("Generated WebAssembly flight runtime smoke test passed.");
