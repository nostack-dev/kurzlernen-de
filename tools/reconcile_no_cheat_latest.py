from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one source pattern, found {count}")
    p.write_text(text.replace(old, new, 1))


# Keep the latest UI test's truthful StateRuntime substring while exposing the
# complete raw hardware boundary that actually precedes it.
replace_once(
    "sim/simulator.mjs",
    'label(){return "raw sensor wire → shared fc::FirmwareRuntime → StateRuntime → Runtime / WASM";}',
    'label(){return "raw sensor wire → shared fc::FirmwareRuntime → shared fc::StateRuntime → fc::Runtime / WASM";}',
)

# The cleaned HIL bridge from current main stays transport-only. HIL v3 merely
# expands the binary input frame because it now carries literal NAV1 bytes.
replace_once("tools/s31_hil_bridge.mjs", "const INPUT_BYTES=64;", "const INPUT_BYTES=80;")
replace_once(
    "tools/s31_hil_bridge.mjs",
    'if(crc32(packet,60)!==packet.readUInt32LE(60))throw new Error("HIL1 CRC mismatch");',
    'if(crc32(packet,76)!==packet.readUInt32LE(76))throw new Error("HIL1 CRC mismatch");',
)

# Reconcile current-main architecture invariants with the stronger raw hardware
# boundary. Keep all direct-Command/no-synthetic-SBUS checks from main.
arch = Path("tests/architecture_invariants.mjs")
s = arch.read_text()
old = '''// Production navigation is a normal linked dependency. The generic image explicitly
// has no navigation and therefore fails GAME closed; a real build replaces that TU.
requireText("esp32/Arondight45_DroneFC_S31.cpp","Arondight45_Navigation.hpp");
requireText("esp32/Arondight45_DroneFC_S31.cpp","navigation::sample(navigation)");
forbidText("esp32/Arondight45_DroneFC_S31.cpp","arondight45_navigation_sample");
requireText("esp32/Arondight45_Navigation.hpp","bool sample(fc::NavigationState& out)");
if(!existsSync("esp32/Arondight45_Navigation_Unavailable.cpp"))fail("explicit unavailable navigation adapter missing");
requireText("esp32/Arondight45_Navigation_Unavailable.cpp","return false");

// Hardware safety/peripheral architecture must survive higher-level work.
for(const marker of ["uart_set_line_inverse","kIntSource","esp_task_wdt","fc::StateRuntime runtime"])
  requireText("esp32/Arondight45_DroneFC_S31.cpp",marker);
requireText("esp32/Arondight45_DroneFC_HIL_S31.cpp","usb_serial_jtag");

// HIL/SIL use the same state runtime and fixed binary protocol; navigation occupies
// the former reserved bytes, not a hidden side channel.
requireText("esp32/Arondight45_HIL_Protocol.hpp","kProtocolVersion = 2");
requireText("esp32/Arondight45_HIL_Protocol.hpp","fc::StateRuntime runtime_");
requireText("esp32/Arondight45_HIL_Protocol.hpp","nav_vx_cms");
requireText("esp32/Arondight45_HIL_Protocol.hpp","nav_agl_mm");
requireText("esp32/Arondight45_HIL_Protocol.hpp","sizeof(InputPacket) == 64");
requireText("sim/Arondight45_DroneFC_SIL_WASM.cpp","Arondight45_HIL_Protocol.hpp");
requireText("sim/Arondight45_DroneFC_SIL_WASM.cpp","hil::RuntimeAdapter runtime");

// Simulator truth is converted into virtual sensors, serialized through HIL and
// consumed by C++; returned PWM then drives the rigid-body plant.
for(const marker of ["class SimNavigationSensors","b3World_CastRayClosest","COLLISION_TERRAIN = 1n","COLLISION_AIRFRAME = 2n","QUERY_RANGEFINDER = 4n","groundRange(12)","FLAG_NAVIGATION_VALID","backend.exchange(packet","physics.step(latest.motors"])
  requireText("sim/simulator.mjs",marker);
requireText("sim/simulator.mjs","filter.maskBits=COLLISION_TERRAIN");
forbidText("sim/simulator.mjs","stateControllerMotor");
'''
new = '''// Production, physical S31 HIL and browser SIL meet at one raw hardware boundary.
// There is no linked cooked NavigationState callback and no second production IMU decoder.
requireText("esp32/Arondight45_DroneFC_S31.cpp","Arondight45_FirmwareRuntime.hpp");
requireText("esp32/Arondight45_DroneFC_S31.cpp","fc::FirmwareRuntime runtime");
requireText("esp32/Arondight45_DroneFC_S31.cpp","sample_imu_registers");
requireText("esp32/Arondight45_DroneFC_S31.cpp","navigation_init");
requireText("esp32/Arondight45_DroneFC_S31.cpp","NavigationWireParser");
for(const dirty of ["Arondight45_Navigation.hpp","navigation::sample(","arondight45_navigation_sample","sample_imu(fc::Imu"])
  forbidText("esp32/Arondight45_DroneFC_S31.cpp",dirty,`production contains a cooked sensor bypass: ${dirty}`);
if(existsSync("esp32/Arondight45_Navigation.hpp")||existsSync("esp32/Arondight45_Navigation_Unavailable.cpp"))
  fail("obsolete cooked navigation adapter survived the raw NAV1 migration");

// Hardware safety/peripheral architecture must survive higher-level work.
for(const marker of ["uart_set_line_inverse","kIntSource","esp_task_wdt","fc::FirmwareRuntime runtime"])
  requireText("esp32/Arondight45_DroneFC_S31.cpp",marker);
requireText("esp32/Arondight45_DroneFC_HIL_S31.cpp","usb_serial_jtag");

// One shared firmware boundary owns all hardware decoding and freshness behavior.
requireText("esp32/Arondight45_FirmwareRuntime.hpp","decode_icm42688_registers");
requireText("esp32/Arondight45_FirmwareRuntime.hpp","decode_navigation_wire");
requireText("esp32/Arondight45_FirmwareRuntime.hpp","decode_sbus");
requireText("esp32/Arondight45_FirmwareRuntime.hpp","kNavigationTimeoutUs");
requireText("esp32/Arondight45_HardwareSensors.hpp","NavigationWireFrame");
requireText("esp32/Arondight45_HardwareSensors.hpp","crc16_ccitt");

// HIL v3 transports literal target-hardware frames, never decoded vx/vy/vz/AGL state.
requireText("esp32/Arondight45_HIL_Protocol.hpp","kProtocolVersion = 3");
requireText("esp32/Arondight45_HIL_Protocol.hpp","fc::FirmwareRuntime runtime_");
requireText("esp32/Arondight45_HIL_Protocol.hpp","navigation_frame[hwcontract::kNavigationFrameBytes]");
requireText("esp32/Arondight45_HIL_Protocol.hpp","sizeof(InputPacket) == 80");
for(const cooked of ["nav_vx_cms","nav_vy_cms","nav_vz_cms","nav_agl_mm"])
  forbidText("esp32/Arondight45_HIL_Protocol.hpp",cooked,`cooked navigation field crossed HIL boundary: ${cooked}`);
requireText("sim/Arondight45_DroneFC_SIL_WASM.cpp","Arondight45_HIL_Protocol.hpp");
requireText("sim/Arondight45_DroneFC_SIL_WASM.cpp","hil::RuntimeAdapter runtime");

// Simulator truth terminates at virtual sensor hardware. ICM bytes arrive at the
// DRDY loop; SBUS and NAV1 arrive asynchronously. Only returned PWM drives the plant.
for(const marker of ["class SimNavigationSensors","class SimSbusReceiver","encodeNavigationWire","b3World_CastRayClosest","COLLISION_TERRAIN = 1n","COLLISION_AIRFRAME = 2n","QUERY_RANGEFINDER = 4n","groundRange(12)","FLAG_NAVIGATION_PRESENT","FLAG_SBUS_PRESENT","backend.exchange(packet","physics.step(latest.motors"])
  requireText("sim/simulator.mjs",marker);
requireText("sim/simulator.mjs","view.setUint32(76,crc32(bytes,76)");
requireText("sim/simulator.mjs","raw sensor wire → shared fc::FirmwareRuntime → shared fc::StateRuntime → fc::Runtime / WASM");
requireText("sim/simulator.mjs","filter.maskBits=COLLISION_TERRAIN");
for(const dirty of ["FLAG_NAVIGATION_VALID","stateControllerMotor"])
  forbidText("sim/simulator.mjs",dirty,`simulator contains decoded/control shortcut: ${dirty}`);
'''
if new not in s:
    if old not in s:
        raise RuntimeError("current-main architecture sensor/HIL block not found")
    s = s.replace(old, new, 1)

old_end = 'console.log("Architecture invariants passed: one C++ motor authority, direct physical commands, explicit navigation dependency, sensorized twin, direct WebRTC control, HIL-only bridge, no browser controller clone.");'
new_end = 'console.log("Architecture invariants passed: one raw hardware boundary, one C++ motor authority, direct physical commands, async ICM/SBUS/NAV1 sensor wires, direct WebRTC control and HIL-only bridge.");'
if new_end not in s:
    if old_end not in s:
        raise RuntimeError("architecture success marker not found")
    s = s.replace(old_end, new_end, 1)
arch.write_text(s)

print("Reconciled latest main with no-cheat raw hardware digital twin")
