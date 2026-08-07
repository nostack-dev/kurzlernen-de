#!/usr/bin/env node
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { WebSocketServer, WebSocket } from "ws";

const CONTROL_PROTOCOL=1;
const DEFAULT_SIM="https://kurzlernen.de/drone_simulator.html";
const DEFAULT_CONTROLLER="https://kurzlernen.de/drone_controller.html";
function option(name,fallback=null){const i=process.argv.indexOf(name);return i>=0&&process.argv[i+1]?process.argv[i+1]:fallback;}
function addresses(){const out=[];for(const entries of Object.values(os.networkInterfaces()))for(const e of entries||[])if(e.family==="IPv4"&&!e.internal)out.push(e.address);return out;}
function validate(html,title,source){if(!html.includes(title))throw Error(`${source} is not the expected page`);if(/src=["']\.\/sim\/(simulator|controller)\.mjs["']/.test(html))throw Error(`${source} is source HTML; provide the built self-contained page`);if(!/<script\s+type=["']module["']>/.test(html))throw Error(`${source} has no inline bundled module`);return html;}
async function load(localOpt,siteOpt,fallback,title){const local=option(localOpt);if(local){const file=path.resolve(local);return validate(await fs.readFile(file,"utf8"),title,file);}const site=option(siteOpt,fallback),response=await fetch(site,{redirect:"follow",headers:{"User-Agent":"Arondight45-Dual-Phone-Relay/1"}});if(!response.ok)throw Error(`Cannot fetch ${site}: HTTP ${response.status}`);return validate(await response.text(),title,site);}

const simulator=Buffer.from(await load("--html","--site",DEFAULT_SIM,"Arondight45 Drone Digital Twin"),"utf8");
const controller=Buffer.from(await load("--controller-html","--controller-site",DEFAULT_CONTROLLER,"Arondight45 Remote Controller"),"utf8");
const port=Number(option("--http-port","8765"));if(!Number.isInteger(port)||port<1||port>65535)throw Error("--http-port must be 1..65535");
const pages=new Map([["/",simulator],["/drone_simulator.html",simulator],["/drone_controller.html",controller]]);
const server=http.createServer((request,response)=>{const pathname=new URL(request.url||"/","http://localhost").pathname,bytes=pages.get(pathname);if(bytes){response.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Content-Length":bytes.length,"X-Content-Type-Options":"nosniff"});response.end(bytes);return;}if(pathname==="/favicon.ico"){response.writeHead(204);response.end();return;}response.writeHead(404,{"Content-Type":"text/plain"});response.end("Not found\n");});
const sockets=new WebSocketServer({noServer:true,maxPayload:4096});server.on("upgrade",(request,socket,head)=>{if(new URL(request.url||"/","http://localhost").pathname!=="/control"){socket.destroy();return;}sockets.handleUpgrade(request,socket,head,ws=>sockets.emit("connection",ws,request));});
const rooms=new Map();
function cleanRoom(v){return typeof v==="string"&&/^[A-Z0-9]{1,12}$/.test(v)?v:null;}
function state(name){if(!rooms.has(name))rooms.set(name,{simulator:null,controller:null});return rooms.get(name);}
function send(ws,msg){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(msg));}
function announce(name){const r=rooms.get(name);if(!r)return;const msg={type:"peer",protocol:CONTROL_PROTOCOL,room:name,simulator:Boolean(r.simulator),controller:Boolean(r.controller)};send(r.simulator,msg);send(r.controller,msg);}
function detach(ws){if(!ws.room||!ws.role)return;const r=rooms.get(ws.room);if(!r)return;if(r[ws.role]===ws)r[ws.role]=null;announce(ws.room);if(!r.simulator&&!r.controller)rooms.delete(ws.room);ws.room=null;ws.role=null;}
sockets.on("connection",(ws,request)=>{ws.isAlive=true;ws.on("pong",()=>ws.isAlive=true);ws.on("message",(raw,binary)=>{if(binary){ws.close(1003,"JSON required");return;}let msg;try{msg=JSON.parse(raw.toString());}catch{ws.close(1007,"invalid JSON");return;}if(msg?.protocol!==CONTROL_PROTOCOL){ws.close(1002,"protocol mismatch");return;}if(msg.type==="join"){const room=cleanRoom(msg.room),role=msg.role;if(!room||!(role==="simulator"||role==="controller")){ws.close(1008,"invalid room or role");return;}detach(ws);const r=state(room);if(r[role]&&r[role]!==ws&&r[role].readyState===WebSocket.OPEN)r[role].close(1012,"replaced");r[role]=ws;ws.room=room;ws.role=role;console.log(`${role} joined ${room} from ${request.socket.remoteAddress}`);send(ws,{type:"joined",protocol:CONTROL_PROTOCOL,room,role});announce(room);return;}if(!ws.room||!ws.role)return;const r=rooms.get(ws.room);if(!r)return;if(msg.type==="control"&&ws.role==="controller")send(r.simulator,msg);else if(msg.type==="telemetry"&&ws.role==="simulator")send(r.controller,msg);});ws.on("close",()=>detach(ws));ws.on("error",()=>detach(ws));});
const heartbeat=setInterval(()=>{for(const ws of sockets.clients){if(!ws.isAlive){ws.terminate();continue;}ws.isAlive=false;ws.ping();}},5000);heartbeat.unref();
server.listen(port,"0.0.0.0",()=>{const print=base=>{console.log(`VIEW:       ${base}/drone_simulator.html?room=DRONE1`);console.log(`CONTROLLER: ${base}/drone_controller.html?room=DRONE1`);};print(`http://127.0.0.1:${port}`);for(const ip of addresses())print(`http://${ip}:${port}`);console.log("Relay contains no flight-control logic. View enforces >350 ms stale-control disarm.");});
function shutdown(){clearInterval(heartbeat);for(const ws of sockets.clients)ws.close(1001,"server shutdown");sockets.close();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref();}process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);
