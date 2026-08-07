import assert from "node:assert/strict";
import {existsSync,readdirSync,readFileSync,statSync} from "node:fs";
import {join,relative} from "node:path";

const root=process.cwd();
const read=path=>readFileSync(join(root,path),"utf8");
const walk=dir=>readdirSync(join(root,dir)).flatMap(name=>{
  const path=join(dir,name),full=join(root,path);
  return statSync(full).isDirectory()?walk(path):[path];
});
const must=(condition,message)=>assert.ok(condition,message);

const sourceFiles=[...walk("esp32"),...walk("sim")].filter(path=>/\.(?:cpp|hpp|mjs)$/.test(path));
for(const path of sourceFiles){
  const source=read(path);
  must(!/#[ \t]*include[ \t]+["<][^">]*\.cpp[">]/.test(source),`${path}: .cpp inclusion is forbidden`);
  must(!/#[ \t]*define[ \t]+main\b/.test(source),`${path}: main macro substitution is forbidden`);
}

const production=read("esp32/Arondight45_DroneFC_S31.cpp");
const protocol=read("esp32/Arondight45_HIL_Protocol.hpp");
const hil=read("esp32/Arondight45_DroneFC_HIL_S31.cpp");
const sil=read("sim/Arondight45_DroneFC_SIL_WASM.cpp");
must(production.includes("Arondight45_DroneFC_Core.hpp")&&production.includes("fc::Runtime runtime"),"production must execute shared fc::Runtime");
must(protocol.includes("Arondight45_DroneFC_Core.hpp")&&protocol.includes("fc::Runtime runtime_"),"HIL protocol must execute shared fc::Runtime");
must(hil.includes("Arondight45_HIL_Protocol.hpp"),"physical HIL firmware must use shared HIL protocol");
must(sil.includes("Arondight45_HIL_Protocol.hpp"),"SIL/WASM must use shared HIL protocol");

const semantics=read("sim/control_semantics.mjs");
must(!semantics.includes("ARM_LIMITS"),"browser code must not duplicate production arming thresholds");
must(!/throttle\s*<=\s*0\.035|Math\.abs\([^)]*roll[^)]*\)\s*<\s*0\.12|Math\.abs\([^)]*yaw[^)]*\)\s*<\s*0\.15/.test(semantics),"browser code must not duplicate production arming gates");
must(semantics.includes('return Boolean(available)&&fcState==="DISARMED";'),"browser ARM control may only expose request availability; fc::Runtime remains authoritative");

const simulator=read("sim/simulator.mjs");
const controller=read("sim/controller.mjs");
const p2p=read("sim/p2p_link.mjs");
must(simulator.includes("new ViewPeerLink()"),"VIEW must use direct P2P control link");
must(controller.includes("ControllerPeerLink"),"CONTROLLER must use direct P2P control link");
must(p2p.includes("new RTCPeerConnection")&&p2p.includes("iceServers:[]"),"P2P transport must stay direct/static-host compatible");
must(!controller.includes("WebSocket")&&!p2p.includes("WebSocket"),"normal controller transport must not grow a relay backend");
must(!/\/control["']/.test(`${simulator}\n${controller}\n${p2p}`),"normal SIM must not use a /control relay route");
must(!p2p.includes("arondight45LastLinkedAt"),"dead persisted reconnect timestamps are forbidden");
must(!p2p.includes("force=false")&&!p2p.includes(",force}"),"dead control-packet force flags are forbidden");

const workflowDir=join(root,".github/workflows");
for(const name of readdirSync(workflowDir)){
  const path=join(workflowDir,name),source=readFileSync(path,"utf8");
  must(!/contents:\s*write/.test(source),`${relative(root,path)}: CI must not self-modify repository contents`);
  must(!/\bgit\s+push\b/.test(source),`${relative(root,path)}: CI must not push migration commits`);
  must(!/patch_shared_control_semantics/.test(source),`${relative(root,path)}: one-shot patch machinery is forbidden`);
}
must(!existsSync(join(workflowDir,"one-shot-shared-controls.yml")),"one-shot self-modifying workflow must stay deleted");

console.log("Architecture guard passed: one shared fc::Runtime, no JS arming-law clone, no controller relay, no self-mutating CI hacks.");
