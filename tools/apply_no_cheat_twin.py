from pathlib import Path
import re


def replace_once(path, old, new):
    p=Path(path);s=p.read_text()
    if new in s:
        return
    n=s.count(old)
    if n!=1: raise RuntimeError(f"{path}: expected one exact pattern, found {n}")
    p.write_text(s.replace(old,new,1))


def regex_once(path, pattern, repl):
    p=Path(path);s=p.read_text();ns,n=re.subn(pattern,repl,s,count=1,flags=re.S)
    if n!=1: raise RuntimeError(f"{path}: regex pattern matched {n}")
    p.write_text(ns)

# ---------------------------------------------------------------------------
# Production firmware: same raw hardware boundary as HIL/SIL. No weak cooked
# navigation state, no duplicate ICM decoder, no direct StateRuntime call.
# ---------------------------------------------------------------------------
p="esp32/Arondight45_DroneFC_S31.cpp"
replace_once(p,'#include "Arondight45_StateControl.hpp"','#include "Arondight45_FirmwareRuntime.hpp"')
replace_once(p,'extern "C" bool __attribute__((weak)) arondight45_navigation_sample(float* vx_mps,float* vy_mps,float* vz_mps,float* agl_m){(void)vx_mps;(void)vy_mps;(void)vz_mps;(void)agl_m;return false;}\n\n','')
replace_once(p,'#ifndef FC_PIN_SBUS\n#define FC_PIN_SBUS 8\n#endif',
'''#ifndef FC_PIN_SBUS
#define FC_PIN_SBUS 8
#endif
#ifndef FC_PIN_NAV_RX
// Physical NAV1 navigation module UART. Override at build time for the target PCB.
#define FC_PIN_NAV_RX 18
#endif
#ifndef FC_NAV_UART_BAUD
#define FC_NAV_UART_BAUD 230400
#endif''')
replace_once(p,'constexpr auto kUart = UART_NUM_1;',
'''constexpr auto kSbusUart = UART_NUM_1;
constexpr auto kNavUart = UART_NUM_2;''')
replace_once(p,'portMUX_TYPE rc_mux = portMUX_INITIALIZER_UNLOCKED;\nfc::RC rc_snapshot{};',
'''portMUX_TYPE wire_mux = portMUX_INITIALIZER_UNLOCKED;
std::array<uint8_t,25> sbus_frame_snapshot{};
uint32_t sbus_generation{};
hwcontract::NavigationWireFrame navigation_frame_snapshot{};
uint32_t navigation_generation{};''')

# The production SPI driver reads bytes only; the shared hardware contract owns
# scaling, invalid-value rejection and board orientation exactly once.
regex_once(p,r'int16_t read_be_i16\(const uint8_t\* p\) \{.*?esp_err_t sample_imu\(fc::Imu& sample\) \{.*?\n\}',
'''esp_err_t sample_imu_registers(std::array<uint8_t,14>& sample) {
    return imu_read(reg::kTempData1, sample.data(), sample.size());
}''')

# Replace the complete receiver section and add the physical NAV1 UART module.
regex_once(p,r'esp_err_t sbus_init\(\) \{.*?fc::RC get_rc_snapshot\(\) \{.*?\n\}',r'''esp_err_t sbus_init() {
    uart_config_t config{};
    config.baud_rate = 100000;
    config.data_bits = UART_DATA_8_BITS;
    config.parity = UART_PARITY_EVEN;
    config.stop_bits = UART_STOP_BITS_2;
    config.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
    config.source_clk = UART_SCLK_DEFAULT;
    HW_TRY(uart_driver_install(kSbusUart, 1024, 0, 0, nullptr, 0), "sbus uart driver");
    HW_TRY(uart_param_config(kSbusUart, &config), "sbus uart config");
    HW_TRY(uart_set_pin(kSbusUart, UART_PIN_NO_CHANGE, FC_PIN_SBUS, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE), "sbus pin");
    HW_TRY(uart_set_line_inverse(kSbusUart, UART_SIGNAL_RXD_INV), "sbus inversion");
    return uart_flush_input(kSbusUart);
}

void sbus_task(void*) {
    hwcontract::SbusWireParser parser;
    std::array<uint8_t,25> frame{};
    uint8_t bytes[64];
    for (;;) {
        const int count = uart_read_bytes(kSbusUart, bytes, sizeof(bytes), pdMS_TO_TICKS(20));
        for (int i = 0; i < count; ++i) {
            if (parser.feed(bytes[i], now_us64(), frame)) {
                portENTER_CRITICAL(&wire_mux);
                sbus_frame_snapshot = frame;
                ++sbus_generation;
                portEXIT_CRITICAL(&wire_mux);
            }
        }
    }
}

esp_err_t navigation_init() {
#if FC_PIN_NAV_RX >= 0
    uart_config_t config{};
    config.baud_rate = FC_NAV_UART_BAUD;
    config.data_bits = UART_DATA_8_BITS;
    config.parity = UART_PARITY_DISABLE;
    config.stop_bits = UART_STOP_BITS_1;
    config.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
    config.source_clk = UART_SCLK_DEFAULT;
    HW_TRY(uart_driver_install(kNavUart, 1024, 0, 0, nullptr, 0), "nav uart driver");
    HW_TRY(uart_param_config(kNavUart, &config), "nav uart config");
    HW_TRY(uart_set_pin(kNavUart, UART_PIN_NO_CHANGE, FC_PIN_NAV_RX, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE), "nav uart pin");
    return uart_flush_input(kNavUart);
#else
    return ESP_OK;
#endif
}

void navigation_task(void*) {
#if FC_PIN_NAV_RX >= 0
    hwcontract::NavigationWireParser parser;
    hwcontract::NavigationWireFrame frame{};
    uint8_t bytes[64];
    for (;;) {
        const int count = uart_read_bytes(kNavUart, bytes, sizeof(bytes), pdMS_TO_TICKS(20));
        for (int i = 0; i < count; ++i) {
            if (parser.feed(bytes[i], frame)) {
                // Do not pre-decode here. FirmwareRuntime validates NAV1 magic,
                // version, CRC, sequence and freshness identically in all targets.
                portENTER_CRITICAL(&wire_mux);
                navigation_frame_snapshot = frame;
                ++navigation_generation;
                portEXIT_CRITICAL(&wire_mux);
            }
        }
    }
#else
    vTaskDelete(nullptr);
#endif
}

void snapshot_wire(std::array<uint8_t,25>& sbus,uint32_t& sbus_gen,
                   hwcontract::NavigationWireFrame& navigation,uint32_t& nav_gen) {
    portENTER_CRITICAL(&wire_mux);
    sbus=sbus_frame_snapshot;sbus_gen=sbus_generation;
    navigation=navigation_frame_snapshot;nav_gen=navigation_generation;
    portEXIT_CRITICAL(&wire_mux);
}''')

replace_once(p,'    fc::StateRuntime runtime;\n    uint64_t last_us = 0;',
'''    fc::FirmwareRuntime runtime;
    uint64_t last_us = 0;
    uint32_t consumed_sbus_generation = 0;
    uint32_t consumed_navigation_generation = 0;''')
replace_once(p,'''        fc::Imu raw;
        if (sample_imu(raw) != ESP_OK) fatal("imu data");
        const uint32_t dt_us = last_us ? static_cast<uint32_t>(now - last_us) : fc::kNominalDtUs;
        last_us = now;

        const fc::RC rc = get_rc_snapshot();
        const bool rc_fresh = rc.valid && now >= rc.us && now - rc.us <= fc::kRcTimeoutUs;''',
'''        std::array<uint8_t,14> imu_registers{};
        if (sample_imu_registers(imu_registers) != ESP_OK) fatal("imu data");
        const uint32_t dt_us = last_us ? static_cast<uint32_t>(now - last_us) : fc::kNominalDtUs;
        last_us = now;''')
replace_once(p,'''        fc::RuntimeInput input{};
        input.raw = raw;
        input.rc = rc;
        input.now_us = now;
        input.dt_us = dt_us;
        input.missed_samples = notifications > 1 ? notifications - 1 : 0;
        input.imu_valid = true;
        input.rc_fresh = rc_fresh;
        fc::NavigationState navigation{};float nav_vx=0,nav_vy=0,nav_vz=0,nav_agl=0;
        if(arondight45_navigation_sample(&nav_vx,&nav_vy,&nav_vz,&nav_agl)){navigation.velocity_world_mps={nav_vx,nav_vy,nav_vz};navigation.agl_m=nav_agl;navigation.valid=true;navigation.valid=fc::finite(navigation);}
        fc::StateRuntimeInput state_input{};state_input.flight=input;state_input.navigation=navigation;
        const fc::RuntimeOutput output = runtime.step(state_input);''',
'''        std::array<uint8_t,25> sbus_frame{};
        hwcontract::NavigationWireFrame navigation_frame{};
        uint32_t sbus_gen=0,nav_gen=0;
        snapshot_wire(sbus_frame,sbus_gen,navigation_frame,nav_gen);

        fc::HardwareFrame hardware{};
        hardware.now_us=now;
        hardware.dt_us=dt_us;
        hardware.missed_samples=notifications>1?notifications-1:0;
        hardware.imu_registers=imu_registers;
        hardware.imu_present=true;
        if(sbus_gen!=consumed_sbus_generation){hardware.sbus_frame=sbus_frame;hardware.sbus_present=true;consumed_sbus_generation=sbus_gen;}
        if(nav_gen!=consumed_navigation_generation){hardware.navigation_frame=navigation_frame;hardware.navigation_present=true;consumed_navigation_generation=nav_gen;}
        const fc::RuntimeOutput output = runtime.step(hardware);''')
replace_once(p,'    ESP_ERROR_CHECK(hw::sbus_init());',
'''    ESP_ERROR_CHECK(hw::sbus_init());
    ESP_ERROR_CHECK(hw::navigation_init());''')
replace_once(p,'''    created = xTaskCreatePinnedToCore(hw::sbus_task, "sbus", 4096, nullptr,
                                     12, nullptr, kServiceCore);
    ESP_ERROR_CHECK(created == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);''',
'''    created = xTaskCreatePinnedToCore(hw::sbus_task, "sbus", 4096, nullptr,
                                     12, nullptr, kServiceCore);
    ESP_ERROR_CHECK(created == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
    created = xTaskCreatePinnedToCore(hw::navigation_task, "nav", 4096, nullptr,
                                     11, nullptr, kServiceCore);
    ESP_ERROR_CHECK(created == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);''')

# ---------------------------------------------------------------------------
# Browser world -> raw sensor wires -> shared firmware. Sensor truth may be used
# only to synthesize hardware measurements, never sent as decoded flight state.
# ---------------------------------------------------------------------------
p="sim/simulator.mjs"
replace_once(p,'''const INPUT_BYTES = 64;
const OUTPUT_BYTES = 32;
const FLAG_IMU_VALID = 1;
const FLAG_RESET = 2;
const FLAG_NAVIGATION_VALID = 4;''',
'''const INPUT_BYTES = 80;
const OUTPUT_BYTES = 32;
const NAVIGATION_BYTES = 20;
const FLAG_IMU_PRESENT = 1;
const FLAG_RESET = 2;
const FLAG_SBUS_PRESENT = 4;
const FLAG_NAVIGATION_PRESENT = 8;''')
replace_once(p,'    if (this.module._fc_protocol_version() !== 2) throw Error("WASM HIL protocol version mismatch");',
'    if (this.module._fc_protocol_version() !== 3) throw Error("WASM HIL protocol version mismatch");')
replace_once(p,'  label(){return "shared fc::StateRuntime → fc::Runtime / WASM";}',
'  label(){return "raw sensor wire → shared fc::FirmwareRuntime → StateRuntime → Runtime / WASM";}')

anchor='''function parseOutput(bytes) {'''
addition=r'''function crc16Ccitt(bytes, length=bytes.byteLength) {
  let crc=0xffff;
  for(let i=0;i<length;i++){
    crc^=bytes[i]<<8;
    for(let bit=0;bit<8;bit++)crc=((crc<<1)^((crc&0x8000)?0x1021:0))&0xffff;
  }
  return crc;
}
function encodeNavigationWire(sequence,measurement){
  const bytes=new Uint8Array(NAVIGATION_BYTES),view=new DataView(bytes.buffer),s16=value=>clamp(Math.round(value*100),-32767,32767);
  view.setUint32(0,0x3156414e,true);view.setUint16(4,1,true);view.setUint16(6,sequence&0xffff,true);
  view.setInt16(8,s16(measurement.vx),true);view.setInt16(10,s16(measurement.vy),true);view.setInt16(12,s16(measurement.vz),true);
  view.setUint16(14,clamp(Math.round(Math.max(0,measurement.agl)*1000),0,65535),true);view.setUint16(16,measurement.valid?1:0,true);
  view.setUint16(18,crc16Ccitt(bytes,18),true);return bytes;
}

'''
replace_once(p,anchor,addition+anchor)

regex_once(p,r'function makeInput\(sequence, imu, sbus, flags, dtUs=1000, navigation=null\) \{.*?\n\}',r'''function makeInput(sequence,imu,sbus,flags,dtUs=1000,navigationFrame=null,missedSamples=0) {
  const bytes=new Uint8Array(INPUT_BYTES),view=new DataView(bytes.buffer);
  view.setUint32(0,INPUT_MAGIC,true);view.setUint32(4,sequence,true);view.setUint32(8,dtUs,true);
  view.setUint16(12,clamp(missedSamples|0,0,65535),true);view.setUint16(14,flags,true);
  bytes.set(imu,16);if(sbus)bytes.set(sbus,30);if(navigationFrame)bytes.set(navigationFrame,55);
  view.setUint32(76,crc32(bytes,76),true);return bytes;
}''')

regex_once(p,r'// Navigation truth is never fed directly to control\..*?class SimNavigationSensors \{.*?\n\}',r'''// The physics world is allowed to know truth only on the sensor side of the
// boundary. The navigation-module twin emits a real NAV1 byte frame at 100 Hz;
// FirmwareRuntime performs the exact production decode, CRC/sequence/freshness path.
class SimNavigationSensors {
  constructor(){this.reset();}
  reset(){this.noise=new Noise(0x7193ab21);this.elapsed=.01;this.filtered=[0,0,0];this.sequence=1;this.last={vx:0,vy:0,vz:0,agl:0,valid:false};}
  sampleFrame(model,dt=DT){
    this.elapsed+=dt;if(this.elapsed<.01)return null;this.elapsed-=.01;
    const truth=model.linear(),alpha=.42;
    for(let i=0;i<3;i++){const measured=truth[i]+this.noise.gaussian()*.025;this.filtered[i]+=alpha*(measured-this.filtered[i]);}
    const range=model.groundRange(12);let valid=range.valid,agl=0;
    if(valid){const measuredSlant=Math.max(0,range.slant+this.noise.gaussian()*.004);agl=measuredSlant*range.verticalProjection;}
    this.last={vx:this.filtered[0],vy:this.filtered[1],vz:this.filtered[2],agl,valid};
    return encodeNavigationWire(this.sequence++,this.last);
  }
}

// SBUS is also asynchronous hardware. The receiver wire updates at 100 Hz while
// the inner IMU/firmware loop remains 1 kHz; cached RC must expire if frames stop.
class SimSbusReceiver {
  constructor(){this.reset();}
  reset(){this.elapsed=.01;}
  sample(makeFrame,dt=DT){this.elapsed+=dt;if(this.elapsed<.01)return null;this.elapsed-=.01;return makeFrame();}
}''')
replace_once(p,'const navigationSensors=new SimNavigationSensors();\nlet latestNavigation=',
'const navigationSensors=new SimNavigationSensors();\nconst sbusReceiver=new SimSbusReceiver();\nlet latestNavigation=')
replace_once(p,'  physics.reset(defaultParams(),initial);navigationSensors.reset();latestNavigation=',
'  physics.reset(defaultParams(),initial);navigationSensors.reset();sbusReceiver.reset();latestNavigation=')
replace_once(p,'''async function controllerStep(){
  const params=defaultParams(),seq=sequence++;latestNavigation=navigationSensors.sample(physics,DT);
  const packet=makeInput(seq,physics.imuRaw(DT),controls(),(params.imuValid?FLAG_IMU_VALID:0)|(resetFlag?FLAG_RESET:0),1000,latestNavigation);resetFlag=false;
  const started=performance.now(),out=await backend.exchange(packet,seq);ui.rtt.textContent=(performance.now()-started).toFixed(2)+" ms";return out;
}''',
'''async function controllerStep(){
  const params=defaultParams(),seq=sequence++,navigationFrame=navigationSensors.sampleFrame(physics,DT),sbusFrame=sbusReceiver.sample(controls,DT);
  latestNavigation=navigationSensors.last;
  let flags=(params.imuValid?FLAG_IMU_PRESENT:0)|(resetFlag?FLAG_RESET:0);if(sbusFrame)flags|=FLAG_SBUS_PRESENT;if(navigationFrame)flags|=FLAG_NAVIGATION_PRESENT;
  const packet=makeInput(seq,physics.imuRaw(DT),sbusFrame,flags,1000,navigationFrame,0);resetFlag=false;
  const started=performance.now(),out=await backend.exchange(packet,seq);ui.rtt.textContent=(performance.now()-started).toFixed(2)+" ms";return out;
}''')
replace_once(p,'if(mode==="sim")return "SIM · primary mode. The shared C++ state outer loop and exact fc::Runtime execute as WebAssembly; sensor measurements, motors and airframe are simulated.";',
'if(mode==="sim")return "SIM · raw ICM/SBUS/NAV1 hardware-wire twin. The exact production FirmwareRuntime → StateRuntime → Runtime executes as WebAssembly; only the environment and sensor hardware are simulated.";')
replace_once(p,'if(mode==="hil")return "HIL · the same state outer loop + fc::Runtime execute on a physical ESP32-S31. Closed-loop time is simulated at 1 kHz; this is functional HIL, not a claim of real IMU-DRDY scheduling validation.";',
'if(mode==="hil")return "HIL · the exact raw hardware-wire FirmwareRuntime executes on the physical ESP32-S31; the host supplies ICM/SBUS/NAV1 bytes and receives only ESC pulses.";')

# LAN bridge framing follows HIL v3 exactly.
p="tools/s31_hil_bridge.mjs"
replace_once(p,'const INPUT_BYTES = 64;','const INPUT_BYTES = 80;')
replace_once(p,'  if (crc32(packet, 60) !== packet.readUInt32LE(60)) throw new Error("HIL1 CRC mismatch");',
'  if (crc32(packet, 76) !== packet.readUInt32LE(76)) throw new Error("HIL1 CRC mismatch");')

# HIL adapter documentation: real MCU executes the same FirmwareRuntime boundary.
p="esp32/Arondight45_DroneFC_HIL_S31.cpp"
replace_once(p,' * The physical S31 executes the exact fc::Runtime used by production firmware.\n * Browser/host supplies HIL1 sensor + SBUS packets and receives HLO1 motor pulses.',
' * The physical S31 executes the exact fc::FirmwareRuntime used by production.\n * Browser/host supplies raw ICM/SBUS/NAV1 wire frames and receives HLO1 motor pulses.')

# Architecture invariants explicitly outlaw the old cooked-state bypass.
p="tests/architecture_invariants.mjs"
replace_once(p,'''requireText("esp32/Arondight45_DroneFC_S31.cpp","Arondight45_StateControl.hpp");
requireText("esp32/Arondight45_DroneFC_S31.cpp","fc::StateRuntime runtime");
requireText("esp32/Arondight45_DroneFC_S31.cpp","arondight45_navigation_sample");
requireText("esp32/Arondight45_HIL_Protocol.hpp","Arondight45_StateControl.hpp");
requireText("esp32/Arondight45_HIL_Protocol.hpp","fc::StateRuntime runtime_");''',
'''requireText("esp32/Arondight45_DroneFC_S31.cpp","Arondight45_FirmwareRuntime.hpp");
requireText("esp32/Arondight45_DroneFC_S31.cpp","fc::FirmwareRuntime runtime");
forbidText("esp32/Arondight45_DroneFC_S31.cpp","arondight45_navigation_sample","production must never accept a cooked simulation-only navigation callback");
requireText("esp32/Arondight45_HIL_Protocol.hpp","Arondight45_FirmwareRuntime.hpp");
requireText("esp32/Arondight45_HIL_Protocol.hpp","fc::FirmwareRuntime runtime_");
requireText("esp32/Arondight45_FirmwareRuntime.hpp","decode_icm42688_registers");
requireText("esp32/Arondight45_FirmwareRuntime.hpp","decode_navigation_wire");
requireText("esp32/Arondight45_FirmwareRuntime.hpp","decode_sbus");''')
replace_once(p,'''// HIL v2 keeps the packet physically identical in size and uses the eight former
// reserved bytes for measured navigation state; no hidden side transport.
requireText("esp32/Arondight45_HIL_Protocol.hpp","kProtocolVersion = 2");
requireText("esp32/Arondight45_HIL_Protocol.hpp","nav_vx_cms");
requireText("esp32/Arondight45_HIL_Protocol.hpp","nav_agl_mm");
requireText("esp32/Arondight45_HIL_Protocol.hpp","sizeof(InputPacket) == 64");''',
'''// HIL v3 transports only raw target-hardware wire frames. Cooked NavigationState
// fields are forbidden at the protocol boundary.
requireText("esp32/Arondight45_HIL_Protocol.hpp","kProtocolVersion = 3");
requireText("esp32/Arondight45_HIL_Protocol.hpp","navigation_frame[hwcontract::kNavigationFrameBytes]");
requireText("esp32/Arondight45_HIL_Protocol.hpp","sizeof(InputPacket) == 80");
for(const cooked of ["nav_vx_cms","nav_vy_cms","nav_vz_cms","nav_agl_mm"])forbidText("esp32/Arondight45_HIL_Protocol.hpp",cooked);''')
replace_once(p,'''requireText("sim/simulator.mjs","FLAG_NAVIGATION_VALID");
requireText("sim/simulator.mjs","view.setInt16(52");
requireText("sim/simulator.mjs","backend.exchange(packet");''',
'''requireText("sim/simulator.mjs","FLAG_NAVIGATION_PRESENT");
requireText("sim/simulator.mjs","encodeNavigationWire");
requireText("sim/simulator.mjs","class SimSbusReceiver");
requireText("sim/simulator.mjs","view.setUint32(76,crc32(bytes,76)");
forbidText("sim/simulator.mjs","FLAG_NAVIGATION_VALID","browser may not inject a decoded navigation-valid shortcut");
requireText("sim/simulator.mjs","backend.exchange(packet");''')

# Production must have a physical NAV1 UART path and use only shared decoding.
insert='''requireText("esp32/Arondight45_DroneFC_S31.cpp","navigation_init");
requireText("esp32/Arondight45_DroneFC_S31.cpp","NavigationWireParser");
requireText("esp32/Arondight45_DroneFC_S31.cpp","sample_imu_registers");
forbidText("esp32/Arondight45_DroneFC_S31.cpp","sample_imu(fc::Imu","production must not own a second IMU decoder");
'''
needle='''requireText("esp32/Arondight45_DroneFC_HIL_S31.cpp","usb_serial_jtag");
'''
replace_once(p,needle,needle+insert)

print("Applied no-cheat raw-hardware digital-twin migration")
