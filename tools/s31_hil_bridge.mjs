#!/usr/bin/env node
/*
 * Arondight45 LAN station.
 *
 * Serves the built simulator + dedicated second-phone controller, relays their
 * control/telemetry channel, and optionally forwards HIL1/HLO1 packets to a
 * physical ESP32-S31. The relay performs no flight-control computation.
 *
 * SIM only / two phones:
 *   npm install ws serialport
 *   node tools/s31_hil_bridge.mjs --sim-only
 *
 * SIM/HIL + two phones:
 *   node tools/s31_hil_bridge.mjs --port /dev/ttyACM0
 *   node tools/s31_hil_bridge.mjs --port COM5
 *
 * The server prints both phone URLs. Both devices must be on the same LAN.
 */

import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { WebSocketServer, WebSocket } from "ws";
import { SerialPort } from "serialport";

const INPUT_BYTES = 80;
const OUTPUT_BYTES = 32;
const INPUT_MAGIC = "HIL1";
const OUTPUT_MAGIC = "HLO1";
const CONTROL_PROTOCOL = 1;
const DEFAULT_SIM_SITE = "https://kurzlernen.de/drone_simulator.html";
const DEFAULT_CONTROLLER_SITE = "https://kurzlernen.de/drone_controller.html";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const hasFlag = name => process.argv.includes(name);

function crc32(buffer, length = buffer.length) {
  let crc = 0xffffffff;
  for (let i = 0; i < length; ++i) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; ++bit) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validateInputPacket(packet) {
  if (!Buffer.isBuffer(packet)) packet = Buffer.from(packet);
  if (packet.length !== INPUT_BYTES) throw new Error(`Expected ${INPUT_BYTES}-byte HIL1 packet`);
  if (packet.subarray(0, 4).toString("ascii") !== INPUT_MAGIC) throw new Error("Invalid HIL1 magic");
  if (crc32(packet, 76) !== packet.readUInt32LE(76)) throw new Error("HIL1 CRC mismatch");
  return packet.readUInt32LE(4);
}

function validateOutputPacket(packet, expectedSequence) {
  if (!Buffer.isBuffer(packet)) packet = Buffer.from(packet);
  if (packet.length !== OUTPUT_BYTES) throw new Error(`Expected ${OUTPUT_BYTES}-byte HLO1 packet`);
  if (packet.subarray(0, 4).toString("ascii") !== OUTPUT_MAGIC) throw new Error("Physical S31 returned invalid HLO1 magic");
  const sequence = packet.readUInt32LE(4);
  if (sequence !== expectedSequence) throw new Error(`HLO1 sequence mismatch: expected ${expectedSequence}, got ${sequence}`);
  if (crc32(packet, 28) !== packet.readUInt32LE(28)) throw new Error("Physical S31 returned invalid HLO1 CRC");
}

function lanAddresses() {
  const result = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) if (entry.family === "IPv4" && !entry.internal) result.push(entry.address);
  }
  return result;
}

async function choosePort(requested) {
  if (requested) return requested;
  const ports = await SerialPort.list();
  const likely = ports.filter(port => /esp|jtag|usb|uart/i.test(`${port.manufacturer || ""} ${port.friendlyName || ""} ${port.path}`));
  const candidates = likely.length ? likely : ports;
  if (candidates.length === 1) return candidates[0].path;
  console.error("Select the physical S31 with --port. Available ports:");
  for (const port of ports) console.error(`  ${port.path}  ${port.manufacturer || ""}`);
  process.exit(2);
}

function validateBuiltHtml(html, title, sourceDescription) {
  if (!html.includes(title)) throw new Error(`${sourceDescription} is not the expected Arondight45 page`);
  if (/src=["']\.\/sim\/(simulator|controller)\.mjs["']/.test(html)) throw new Error(`${sourceDescription} is unbuilt source HTML`);
  if (!/<script\s+type=["']module["']>/.test(html)) throw new Error(`${sourceDescription} has no inline bundled module`);
  return html;
}

async function loadBuiltHtml(localOption, siteOption, fallbackSite, title) {
  const localPath = option(localOption);
  if (localPath) {
    const resolved = path.resolve(localPath);
    return validateBuiltHtml(await fs.readFile(resolved, "utf8"), title, resolved);
  }
  const site = option(siteOption, fallbackSite);
  const response = await fetch(site, {redirect:"follow",headers:{"User-Agent":"Arondight45-LAN-Station/2"}});
  if (!response.ok) throw new Error(`Cannot fetch built page ${site}: HTTP ${response.status}`);
  return validateBuiltHtml(await response.text(), title, site);
}

class SerialExchange {
  constructor(port) {
    this.port = port;this.buffer = Buffer.alloc(0);this.waiters = [];this.chain = Promise.resolve();
    port.on("data", chunk => {this.buffer = Buffer.concat([this.buffer, chunk]);this.flush();});
    port.on("error", error => this.rejectAll(error));
    port.on("close", () => this.rejectAll(new Error("S31 serial port closed")));
  }
  flush() {
    while (this.waiters.length && this.buffer.length >= this.waiters[0].count) {
      const waiter = this.waiters.shift(), data = this.buffer.subarray(0, waiter.count);
      this.buffer = this.buffer.subarray(waiter.count);clearTimeout(waiter.timer);waiter.resolve(data);
    }
  }
  rejectAll(error) {while (this.waiters.length) {const waiter=this.waiters.shift();clearTimeout(waiter.timer);waiter.reject(error);}}
  readExact(count, timeoutMs = 2000) {
    if (this.buffer.length >= count) {const data=this.buffer.subarray(0,count);this.buffer=this.buffer.subarray(count);return Promise.resolve(data);}
    return new Promise((resolve,reject)=>{const waiter={count,resolve,reject,timer:null};waiter.timer=setTimeout(()=>{const index=this.waiters.indexOf(waiter);if(index>=0)this.waiters.splice(index,1);reject(new Error(`S31 response timeout: ${count} bytes expected`));},timeoutMs);this.waiters.push(waiter);});
  }
  exchange(rawPacket) {
    const packet=Buffer.isBuffer(rawPacket)?rawPacket:Buffer.from(rawPacket),sequence=validateInputPacket(packet);
    const operation=this.chain.catch(()=>undefined).then(async()=>{this.buffer=Buffer.alloc(0);await new Promise((resolve,reject)=>this.port.write(packet,error=>error?reject(error):resolve()));await new Promise((resolve,reject)=>this.port.drain(error=>error?reject(error):resolve()));const response=await this.readExact(OUTPUT_BYTES);validateOutputPacket(response,sequence);return response;});
    this.chain=operation.then(()=>undefined,()=>undefined);return operation;
  }
}

const simulatorHtml = await loadBuiltHtml("--html", "--site", DEFAULT_SIM_SITE, "Arondight45 Drone Digital Twin");
const controllerHtml = await loadBuiltHtml("--controller-html", "--controller-site", DEFAULT_CONTROLLER_SITE, "Arondight45 Remote Controller");
const pages = new Map([
  ["/", Buffer.from(simulatorHtml,"utf8")],
  ["/drone_simulator.html", Buffer.from(simulatorHtml,"utf8")],
  ["/drone_controller.html", Buffer.from(controllerHtml,"utf8")],
]);
const simOnly = hasFlag("--sim-only");
const baudRate = Number(option("--baud", "2000000"));
const httpPort = Number(option("--http-port", "8765"));
if (!Number.isInteger(baudRate) || baudRate <= 0) throw new Error("--baud must be a positive integer");
if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) throw new Error("--http-port must be 1..65535");

let serial = null;
let exchange = null;
let serialPath = null;
if (!simOnly) {
  serialPath = await choosePort(option("--port"));
  serial = new SerialPort({path:serialPath,baudRate,autoOpen:false});
  await new Promise((resolve,reject)=>serial.open(error=>error?reject(error):resolve()));
  exchange = new SerialExchange(serial);
}

const server = http.createServer((request,response)=>{
  const requested=new URL(request.url||"/","http://localhost").pathname;
  const bytes=pages.get(requested);
  if(bytes){response.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Content-Length":bytes.length,"X-Content-Type-Options":"nosniff"});response.end(bytes);return;}
  if(requested==="/favicon.ico"){response.writeHead(204,{"Cache-Control":"public,max-age=86400"});response.end();return;}
  response.writeHead(404,{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"});response.end("Not found\n");
});

const hilSockets = new WebSocketServer({noServer:true,maxPayload:INPUT_BYTES});
const controlSockets = new WebSocketServer({noServer:true,maxPayload:4096});
server.on("upgrade",(request,socket,head)=>{
  const pathname=new URL(request.url||"/","http://localhost").pathname;
  if(pathname==="/hil") {
    if(!exchange){socket.destroy();return;}
    hilSockets.handleUpgrade(request,socket,head,ws=>hilSockets.emit("connection",ws,request));return;
  }
  if(pathname==="/control"){controlSockets.handleUpgrade(request,socket,head,ws=>controlSockets.emit("connection",ws,request));return;}
  socket.destroy();
});

let activeHilClient = null;
hilSockets.on("connection",(ws,request)=>{
  const peer=request.socket.remoteAddress;
  if(activeHilClient&&activeHilClient.readyState===WebSocket.OPEN){ws.close(1013,"one HIL client at a time");return;}
  activeHilClient=ws;console.log(`HIL client connected: ${peer}`);
  ws.on("message",async(data,binary)=>{if(!binary){ws.close(1003,"binary HIL packets required");return;}try{const response=await exchange.exchange(Buffer.from(data));if(ws.readyState===WebSocket.OPEN)ws.send(response,{binary:true});}catch(error){console.error(`HIL exchange failed: ${error.message}`);if(ws.readyState===WebSocket.OPEN)ws.close(1011,error.message.slice(0,120));}});
  ws.on("close",()=>{if(activeHilClient===ws)activeHilClient=null;console.log(`HIL client disconnected: ${peer}`);});
});

const rooms = new Map();
function cleanRoom(value){return typeof value==="string"&&/^[A-Z0-9]{1,12}$/.test(value)?value:null;}
function roomState(name){if(!rooms.has(name))rooms.set(name,{simulator:null,controller:null});return rooms.get(name);}
function sendJson(ws,message){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(message));}
function announce(name){const room=rooms.get(name);if(!room)return;const message={type:"peer",protocol:CONTROL_PROTOCOL,room:name,simulator:Boolean(room.simulator),controller:Boolean(room.controller)};sendJson(room.simulator,message);sendJson(room.controller,message);}
function detach(ws){if(!ws.room||!ws.role)return;const room=rooms.get(ws.room);if(!room)return;if(room[ws.role]===ws)room[ws.role]=null;announce(ws.room);if(!room.simulator&&!room.controller)rooms.delete(ws.room);ws.room=null;ws.role=null;}
controlSockets.on("connection",(ws,request)=>{
  ws.isAlive=true;ws.on("pong",()=>{ws.isAlive=true;});
  ws.on("message",(raw,binary)=>{
    if(binary){ws.close(1003,"JSON control protocol required");return;}
    let message;try{message=JSON.parse(raw.toString());}catch{ws.close(1007,"invalid JSON");return;}
    if(message?.protocol!==CONTROL_PROTOCOL){ws.close(1002,"control protocol mismatch");return;}
    if(message.type==="join"){
      const roomName=cleanRoom(message.room),role=message.role;if(!roomName||!(role==="simulator"||role==="controller")){ws.close(1008,"invalid room or role");return;}
      detach(ws);const room=roomState(roomName);if(room[role]&&room[role]!==ws&&room[role].readyState===WebSocket.OPEN)room[role].close(1012,"replaced by new peer");
      room[role]=ws;ws.room=roomName;ws.role=role;console.log(`Control ${role} joined room ${roomName} from ${request.socket.remoteAddress}`);sendJson(ws,{type:"joined",protocol:CONTROL_PROTOCOL,room:roomName,role});announce(roomName);return;
    }
    if(!ws.room||!ws.role)return;
    const room=rooms.get(ws.room);if(!room)return;
    if(message.type==="control"&&ws.role==="controller")sendJson(room.simulator,message);
    else if(message.type==="telemetry"&&ws.role==="simulator")sendJson(room.controller,message);
  });
  ws.on("close",()=>detach(ws));ws.on("error",()=>detach(ws));
});
const controlHeartbeat=setInterval(()=>{for(const ws of controlSockets.clients){if(!ws.isAlive){ws.terminate();continue;}ws.isAlive=false;ws.ping();}},5000);controlHeartbeat.unref();

server.listen(httpPort,"0.0.0.0",()=>{
  if(serialPath)console.log(`Physical S31: ${serialPath} at ${baudRate} baud`);else console.log("S31: disabled (--sim-only)");
  console.log(`Simulator bytes: ${pages.get("/drone_simulator.html").length}`);console.log(`Controller bytes: ${pages.get("/drone_controller.html").length}`);
  const print=url=>{console.log(`  VIEW:       ${url}/drone_simulator.html?room=DRONE1`);console.log(`  CONTROLLER: ${url}/drone_controller.html?room=DRONE1`);};
  console.log("Open on two devices:");print(`http://127.0.0.1:${httpPort}`);for(const address of lanAddresses())print(`http://${address}:${httpPort}`);
  console.log("Control relay is transport only. Missing controller packets cause simulator-side fail-safe neutral/disarm.");
});

function shutdown(){console.log("\nStopping Arondight45 LAN station.");clearInterval(controlHeartbeat);activeHilClient?.close(1001,"bridge shutting down");for(const ws of controlSockets.clients)ws.close(1001,"server shutting down");hilSockets.close();controlSockets.close();server.close(()=>{if(serial)serial.close(()=>process.exit(0));else process.exit(0);});setTimeout(()=>process.exit(0),1500).unref();}
process.on("SIGINT",shutdown);
process.on("SIGTERM",shutdown);
