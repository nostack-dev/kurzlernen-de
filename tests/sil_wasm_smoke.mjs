import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const modulePath = process.argv[2];
if (!modulePath) throw new Error("usage: node tests/sil_wasm_smoke.mjs <flight_core.mjs>");
const { default: createCore } = await import(pathToFileURL(resolve(modulePath)).href);
const core = await createCore();

const INPUT_MAGIC = 0x314c4948;
const OUTPUT_MAGIC = 0x314f4c48;
const INPUT_BYTES = 80;
const FLAG_IMU_PRESENT = 1;
const FLAG_RESET = 2;
const FLAG_SBUS_PRESENT = 4;
const FLAG_NAVIGATION_PRESENT = 8;
const STATE_ARMED = 1;
const STATE_CALIBRATING = 2;
const STATE_FAULT = 4;
const STATE_RC_VALID = 1 << 3;
const STATE_NAVIGATION_VALID = 1 << 5;
const STATE_GAME_MODE = 1 << 6;

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
function crc16(bytes, length = bytes.length) {
  let crc = 0xffff;
  for (let i = 0; i < length; ++i) {
    crc ^= bytes[i] << 8;
    for (let bit = 0; bit < 8; ++bit) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
  }
  return crc;
}
function encodeSbus(channels) {
  const p = new Uint8Array(25);p[0] = 0x0f;p[24] = 0;
  for (let channel = 0; channel < 16; ++channel) for (let bit = 0; bit < 11; ++bit) {
    if (channels[channel] & (1 << bit)) {const k = 8 + channel * 11 + bit;p[k >> 3] |= 1 << (k & 7);}
  }
  return p;
}
function navigationWire(sequence, nav) {
  const bytes = new Uint8Array(20), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x3156414e, true); // NAV1
  view.setUint16(4, 1, true);view.setUint16(6, sequence & 0xffff, true);
  const s16 = value => Math.max(-32767, Math.min(32767, Math.round(value * 100)));
  view.setInt16(8, s16(nav.vx), true);view.setInt16(10, s16(nav.vy), true);view.setInt16(12, s16(nav.vz), true);
  view.setUint16(14, Math.max(0, Math.min(65535, Math.round(nav.agl * 1000))), true);
  view.setUint16(16, nav.valid === false ? 0 : 1, true);view.setUint16(18, crc16(bytes, 18), true);
  return bytes;
}
function packet(sequence, {channels=null, reset=false, nav=null, navSequence=0, missed=0, imu=true}={}) {
  const bytes = new Uint8Array(INPUT_BYTES), view = new DataView(bytes.buffer);
  view.setUint32(0, INPUT_MAGIC, true);view.setUint32(4, sequence, true);view.setUint32(8, 1000, true);
  view.setUint16(12, missed, true);
  let flags = (imu ? FLAG_IMU_PRESENT : 0) | (reset ? FLAG_RESET : 0);
  bytes[22] = 0x08; // imu_registers offset 16 + 6 => +1g Z at 2048 LSB/g.
  if (channels) {flags |= FLAG_SBUS_PRESENT;bytes.set(encodeSbus(channels), 30);}
  if (nav) {flags |= FLAG_NAVIGATION_PRESENT;bytes.set(navigationWire(navSequence, nav), 55);}
  view.setUint16(14, flags, true);view.setUint32(76, crc32(bytes, 76), true);return bytes;
}
function readOutput() {
  const ptr = core._fc_output_buffer(), bytes = core.HEAPU8.slice(ptr, ptr + 32);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  check(view.getUint32(0, true) === OUTPUT_MAGIC, "output magic");check(crc32(bytes, 28) === view.getUint32(28, true), "output CRC");
  return {state:view.getUint16(22,true),motors:[view.getUint16(8,true),view.getUint16(10,true),view.getUint16(12,true),view.getUint16(14,true)]};
}
function exchange(bytes) {core.HEAPU8.set(bytes, core._fc_input_buffer());core._fc_process();return readOutput();}

check(core._fc_input_size() === 80, "input size");check(core._fc_output_size() === 32, "output size");check(core._fc_protocol_version() === 3, "protocol version");core._fc_reset();
const channels = new Array(16).fill(992);channels[2]=172;channels[4]=172;let output;
for(let i=0;i<2001;++i) output=exchange(packet(i,{channels:i%10===0?channels:null,reset:i===0}));
check((output.state&STATE_CALIBRATING)===0,"calibration completes");check((output.state&STATE_FAULT)===0,"calibration fault-free");

channels[4]=1811;
for(let i=0;i<1002;++i) output=exchange(packet(3000+i,{channels:i%10===0?channels:null}));
check((output.state&STATE_ARMED)!==0,"manual arming through async receiver wire");check(output.motors.every(p=>p===1050),"manual armed idle pulse");
channels[2]=700;output=exchange(packet(5005,{channels}));check(output.motors.every(p=>p>1050),"manual throttle output");

// Stop SBUS frames: firmware cache must age out exactly as on the target receiver UART.
for(let i=0;i<120;++i) output=exchange(packet(5100+i));
check((output.state&STATE_ARMED)===0,"receiver timeout disarms");check((output.state&STATE_RC_VALID)===0,"receiver validity expires");

// GAME mode: navigation is a real NAV1 frame, never cooked HIL state.
core._fc_reset();channels.fill(992);channels[2]=172;channels[4]=172;channels[5]=718;channels[6]=1811;let navSequence=1;
for(let i=0;i<2001;++i){const tick=i%10===0;output=exchange(packet(6000+i,{channels:tick?channels:null,reset:i===0,nav:tick?{vx:0,vy:0,vz:0,agl:.02}:null,navSequence:tick?navSequence++:0}));}
check((output.state&STATE_GAME_MODE)!==0,"game mode active after calibration");check((output.state&STATE_NAVIGATION_VALID)!==0,"fresh NAV1 is valid");

// No fresh NAV1 for >60 ms => GAME fails closed, despite continued 1 kHz IMU and SBUS.
for(let i=0;i<70;++i) output=exchange(packet(8100+i,{channels:i%10===0?channels:null}));
check((output.state&STATE_NAVIGATION_VALID)===0,"navigation freshness expires");check((output.state&STATE_ARMED)===0,"game cannot arm without navigation");

channels[4]=172;output=exchange(packet(8200,{channels,nav:{vx:0,vy:0,vz:0,agl:.02},navSequence:navSequence++}));
channels[4]=1811;
for(let i=0;i<1002;++i){const tick=i%10===0;output=exchange(packet(8201+i,{channels:tick?channels:null,nav:tick?{vx:0,vy:0,vz:0,agl:.02}:null,navSequence:tick?navSequence++:0}));}
check((output.state&STATE_GAME_MODE)!==0,"game mode active");check((output.state&STATE_NAVIGATION_VALID)!==0,"navigation valid");check((output.state&STATE_ARMED)!==0,"game arming");check(output.motors.some(p=>p>1050),"ground-clearance controller produces physical thrust");
console.log("Generated WebAssembly raw-hardware FirmwareRuntime smoke test passed.");
