import {existsSync,readFileSync,readdirSync,statSync} from "node:fs";
import {join} from "node:path";

const read=path=>readFileSync(path,"utf8");
const fail=message=>{throw new Error(`ARCHITECTURE INVARIANT FAILED: ${message}`);};
const requireText=(path,text,message=`${path} must contain ${JSON.stringify(text)}`)=>{
  if(!read(path).includes(text))fail(message);
};
const forbidText=(path,text,message=`${path} must not contain ${JSON.stringify(text)}`)=>{
  if(read(path).includes(text))fail(message);
};
const walk=(root,accept)=>{
  const out=[];
  for(const name of readdirSync(root)){
    const path=join(root,name),stat=statSync(path);
    if(stat.isDirectory())out.push(...walk(path,accept));
    else if(accept(path))out.push(path);
  }
  return out;
};

// No source-inclusion/preprocessor shortcuts: Production, HIL and SIL must all
// consume the same real C++ runtime through headers and normal translation units.
for(const path of [...walk("esp32",p=>/\.(?:cpp|hpp)$/.test(p)),...walk("sim",p=>/\.(?:cpp|hpp)$/.test(p))]){
  const source=read(path);
  if(/#[ \t]*include[ \t]+["<][^">]*\.cpp[">]/.test(source))fail(`${path} includes a .cpp translation unit`);
  if(/#[ \t]*define[ \t]+main\b/.test(source))fail(`${path} rewrites main with the preprocessor`);
}
requireText("esp32/Arondight45_DroneFC_S31.cpp","Arondight45_DroneFC_Core.hpp");
requireText("esp32/Arondight45_DroneFC_S31.cpp","fc::Runtime runtime");
requireText("esp32/Arondight45_HIL_Protocol.hpp","Arondight45_DroneFC_Core.hpp");
requireText("esp32/Arondight45_HIL_Protocol.hpp","fc::Runtime runtime_");
requireText("esp32/Arondight45_DroneFC_HIL_S31.cpp","Arondight45_HIL_Protocol.hpp");
requireText("esp32/Arondight45_DroneFC_HIL_S31.cpp","hil::RuntimeAdapter runtime");
requireText("sim/Arondight45_DroneFC_SIL_WASM.cpp","Arondight45_HIL_Protocol.hpp");

// Production hardware safety/peripheral invariants that must not disappear
// during simulator work.
for(const marker of ["uart_set_line_inverse","kIntSource","esp_task_wdt"])
  requireText("esp32/Arondight45_DroneFC_S31.cpp",marker);
requireText("esp32/Arondight45_DroneFC_HIL_S31.cpp","usb_serial_jtag");

// GitHub Pages source pages remain ordinary source entry points; deploy.yml is
// responsible for producing self-contained single-file artifacts.
requireText("drone_simulator.html",'<script type="module" src="./sim/simulator.mjs"></script>');
requireText("drone_controller.html",'<script type="module" src="./sim/controller.mjs"></script>');

// Normal two-phone SIM is direct browser-to-browser WebRTC. HIL's optional
// local bridge is intentionally outside this check.
requireText("sim/p2p_link.mjs","new RTCPeerConnection");
requireText("sim/p2p_link.mjs","iceServers:[]");
requireText("sim/p2p_link.mjs","CONTROL_STALE_MS = 350");
requireText("sim/p2p_link.mjs","SESSION_GRACE_MS = 5 * 60 * 1000");
for(const path of ["sim/p2p_link.mjs","sim/controller.mjs"]){
  forbidText(path,"WebSocket",`${path} must not contain a relay transport`);
  forbidText(path,'/control"',`${path} must not contain a controller relay route`);
  forbidText(path,"/control'",`${path} must not contain a controller relay route`);
}
requireText("sim/simulator.mjs","new ViewPeerLink()");
requireText("sim/controller.mjs","ControllerPeerLink");
forbidText("sim/simulator.mjs","RemoteControlLink");
requireText("sim/simulator.mjs","control_semantics.mjs");
requireText("sim/controller.mjs","control_semantics.mjs");
requireText("sim/simulator.mjs","new QrScanner");
requireText("sim/controller.mjs","new QrScanner");

// Phone settings are an input-device adapter only. Legacy gain/sensitivity
// shortcuts that changed command authority are not permitted back in.
for(const path of ["sim/control_semantics.mjs","sim/control_settings.mjs"]){
  forbidText(path,"MIN_PHONE_GAIN");
  forbidText(path,"MAX_PHONE_GAIN");
}
requireText("sim/control_semantics.mjs","Full stick always stays full command");
requireText("sim/control_semantics.mjs","x*(1-expo)+x*x*x*expo");

// One-shot self-mutating workflows/patchers were migration scaffolding, not
// production architecture. They must stay gone.
if(existsSync(".github/workflows/one-shot-shared-controls.yml"))fail("one-shot self-mutating workflow returned");
if(existsSync("tools/patch_shared_control_semantics.py"))fail("one-shot source patcher returned");

console.log("Architecture invariants passed: one shared C++ flight runtime, no source hacks, direct static WebRTC control path, input-only phone shaping, no self-mutating migration scaffolding.");
