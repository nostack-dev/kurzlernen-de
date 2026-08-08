#!/usr/bin/env node
/*
 * Arondight45 physical-HIL station.
 *
 * Standard SIM control is browser-to-browser WebRTC and never passes through this
 * process. This optional local tool only serves the already-built static pages and
 * forwards HIL1/HLO1 packets between the simulator and one physical ESP32-S31.
 */

import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {WebSocketServer,WebSocket} from "ws";
import {SerialPort} from "serialport";

const INPUT_BYTES=80;
const OUTPUT_BYTES=32;
const INPUT_MAGIC="HIL1";
const OUTPUT_MAGIC="HLO1";
const DEFAULT_SIM_SITE="https://kurzlernen.de/drone_simulator.html";
const DEFAULT_CONTROLLER_SITE="https://kurzlernen.de/drone_controller.html";

function option(name,fallback=null){const index=process.argv.indexOf(name);return index>=0&&process.argv[index+1]?process.argv[index+1]:fallback;}
function crc32(buffer,length=buffer.length){let crc=0xffffffff;for(let i=0;i<length;++i){crc^=buffer[i];for(let bit=0;bit<8;++bit)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function validateInputPacket(packet){if(!Buffer.isBuffer(packet))packet=Buffer.from(packet);if(packet.length!==INPUT_BYTES)throw new Error(`Expected ${INPUT_BYTES}-byte HIL1 packet`);if(packet.subarray(0,4).toString("ascii")!==INPUT_MAGIC)throw new Error("Invalid HIL1 magic");if(crc32(packet,76)!==packet.readUInt32LE(76))throw new Error("HIL1 CRC mismatch");return packet.readUInt32LE(4);}
function validateOutputPacket(packet,expectedSequence){if(!Buffer.isBuffer(packet))packet=Buffer.from(packet);if(packet.length!==OUTPUT_BYTES)throw new Error(`Expected ${OUTPUT_BYTES}-byte HLO1 packet`);if(packet.subarray(0,4).toString("ascii")!==OUTPUT_MAGIC)throw new Error("Physical S31 returned invalid HLO1 magic");const sequence=packet.readUInt32LE(4);if(sequence!==expectedSequence)throw new Error(`HLO1 sequence mismatch: expected ${expectedSequence}, got ${sequence}`);if(crc32(packet,28)!==packet.readUInt32LE(28))throw new Error("Physical S31 returned invalid HLO1 CRC");}
function lanAddresses(){const result=[];for(const entries of Object.values(os.networkInterfaces()))for(const entry of entries||[])if(entry.family==="IPv4"&&!entry.internal)result.push(entry.address);return result;}

async function choosePort(requested){
  if(requested)return requested;
  const ports=await SerialPort.list();
  const likely=ports.filter(port=>/esp|jtag|usb|uart/i.test(`${port.manufacturer||""} ${port.friendlyName||""} ${port.path}`));
  const candidates=likely.length?likely:ports;
  if(candidates.length===1)return candidates[0].path;
  console.error("Select the physical S31 with --port. Available ports:");
  for(const port of ports)console.error(`  ${port.path}  ${port.manufacturer||""}`);
  process.exit(2);
}

function validateBuiltHtml(html,title,sourceDescription){
  if(!html.includes(title))throw new Error(`${sourceDescription} is not the expected Arondight45 page`);
  if(/src=["']\.\/sim\/(simulator|controller)\.mjs["']/.test(html))throw new Error(`${sourceDescription} is unbuilt source HTML`);
  if(!/<script\s+type=["']module["']>/.test(html))throw new Error(`${sourceDescription} has no inline bundled module`);
  return html;
}
async function loadBuiltHtml(localOption,siteOption,fallbackSite,title){
  const localPath=option(localOption);
  if(localPath){const resolved=path.resolve(localPath);return validateBuiltHtml(await fs.readFile(resolved,"utf8"),title,resolved);}
  const site=option(siteOption,fallbackSite);
  const response=await fetch(site,{redirect:"follow",headers:{"User-Agent":"Arondight45-HIL-Station/3"}});
  if(!response.ok)throw new Error(`Cannot fetch built page ${site}: HTTP ${response.status}`);
  return validateBuiltHtml(await response.text(),title,site);
}

class SerialExchange{
  constructor(port){this.port=port;this.buffer=Buffer.alloc(0);this.waiters=[];this.chain=Promise.resolve();port.on("data",chunk=>{this.buffer=Buffer.concat([this.buffer,chunk]);this.flush();});port.on("error",error=>this.rejectAll(error));port.on("close",()=>this.rejectAll(new Error("S31 serial port closed")));}
  flush(){while(this.waiters.length&&this.buffer.length>=this.waiters[0].count){const waiter=this.waiters.shift(),data=this.buffer.subarray(0,waiter.count);this.buffer=this.buffer.subarray(waiter.count);clearTimeout(waiter.timer);waiter.resolve(data);}}
  rejectAll(error){while(this.waiters.length){const waiter=this.waiters.shift();clearTimeout(waiter.timer);waiter.reject(error);}}
  readExact(count,timeoutMs=2000){if(this.buffer.length>=count){const data=this.buffer.subarray(0,count);this.buffer=this.buffer.subarray(count);return Promise.resolve(data);}return new Promise((resolve,reject)=>{const waiter={count,resolve,reject,timer:null};waiter.timer=setTimeout(()=>{const index=this.waiters.indexOf(waiter);if(index>=0)this.waiters.splice(index,1);reject(new Error(`S31 response timeout: ${count} bytes expected`));},timeoutMs);this.waiters.push(waiter);});}
  exchange(rawPacket){const packet=Buffer.isBuffer(rawPacket)?rawPacket:Buffer.from(rawPacket),sequence=validateInputPacket(packet);const operation=this.chain.catch(()=>undefined).then(async()=>{this.buffer=Buffer.alloc(0);await new Promise((resolve,reject)=>this.port.write(packet,error=>error?reject(error):resolve()));await new Promise((resolve,reject)=>this.port.drain(error=>error?reject(error):resolve()));const response=await this.readExact(OUTPUT_BYTES);validateOutputPacket(response,sequence);return response;});this.chain=operation.then(()=>undefined,()=>undefined);return operation;}
}

const simulatorHtml=await loadBuiltHtml("--html","--site",DEFAULT_SIM_SITE,"Arondight45 Drone Digital Twin");
const controllerHtml=await loadBuiltHtml("--controller-html","--controller-site",DEFAULT_CONTROLLER_SITE,"Arondight45 Remote Controller");
const pages=new Map([["/",Buffer.from(simulatorHtml,"utf8")],["/drone_simulator.html",Buffer.from(simulatorHtml,"utf8")],["/drone_controller.html",Buffer.from(controllerHtml,"utf8")]]);
const baudRate=Number(option("--baud","2000000"));
const httpPort=Number(option("--http-port","8765"));
if(!Number.isInteger(baudRate)||baudRate<=0)throw new Error("--baud must be a positive integer");
if(!Number.isInteger(httpPort)||httpPort<1||httpPort>65535)throw new Error("--http-port must be 1..65535");

const serialPath=await choosePort(option("--port"));
const serial=new SerialPort({path:serialPath,baudRate,autoOpen:false});
await new Promise((resolve,reject)=>serial.open(error=>error?reject(error):resolve()));
const exchange=new SerialExchange(serial);

const server=http.createServer((request,response)=>{
  const requested=new URL(request.url||"/","http://localhost").pathname;
  const bytes=pages.get(requested);
  if(bytes){response.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Content-Length":bytes.length,"X-Content-Type-Options":"nosniff"});response.end(bytes);return;}
  if(requested==="/favicon.ico"){response.writeHead(204,{"Cache-Control":"public,max-age=86400"});response.end();return;}
  response.writeHead(404,{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"});response.end("Not found\n");
});

const hilSockets=new WebSocketServer({noServer:true,maxPayload:INPUT_BYTES});
server.on("upgrade",(request,socket,head)=>{
  const pathname=new URL(request.url||"/","http://localhost").pathname;
  if(pathname!=="/hil"){socket.destroy();return;}
  hilSockets.handleUpgrade(request,socket,head,ws=>hilSockets.emit("connection",ws,request));
});

let activeHilClient=null;
hilSockets.on("connection",(ws,request)=>{
  const peer=request.socket.remoteAddress;
  if(activeHilClient&&activeHilClient.readyState===WebSocket.OPEN){ws.close(1013,"one HIL client at a time");return;}
  activeHilClient=ws;console.log(`HIL client connected: ${peer}`);
  ws.on("message",async(data,binary)=>{
    if(!binary){ws.close(1003,"binary HIL packets required");return;}
    try{const response=await exchange.exchange(Buffer.from(data));if(ws.readyState===WebSocket.OPEN)ws.send(response,{binary:true});}
    catch(error){console.error(`HIL exchange failed: ${error.message}`);if(ws.readyState===WebSocket.OPEN)ws.close(1011,error.message.slice(0,120));}
  });
  ws.on("close",()=>{if(activeHilClient===ws)activeHilClient=null;console.log(`HIL client disconnected: ${peer}`);});
});

server.listen(httpPort,"0.0.0.0",()=>{
  console.log(`Physical S31: ${serialPath} at ${baudRate} baud`);
  console.log(`HIL endpoint: ws://127.0.0.1:${httpPort}/hil`);
  const print=url=>{console.log(`  VIEW:       ${url}/drone_simulator.html`);console.log(`  CONTROLLER: ${url}/drone_controller.html`);};
  console.log("Optional local static pages:");print(`http://127.0.0.1:${httpPort}`);for(const address of lanAddresses())print(`http://${address}:${httpPort}`);
  console.log("Normal two-phone control remains direct WebRTC; this process carries HIL packets only.");
});

function shutdown(){console.log("\nStopping Arondight45 HIL station.");activeHilClient?.close(1001,"bridge shutting down");hilSockets.close();server.close(()=>serial.close(()=>process.exit(0)));setTimeout(()=>process.exit(0),1500).unref();}
process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);
