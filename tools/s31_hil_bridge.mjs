#!/usr/bin/env node
/*
 * Arondight45 S31 functional-HIL LAN bridge.
 *
 * This process does exactly two things:
 *   1) serve the already-built, self-contained browser simulator, and
 *   2) forward validated binary HIL1/HLO1 packets between WebSocket and the
 *      physical ESP32-S31 USB serial port.
 *
 * It performs no flight-control computation and therefore cannot mask or
 * replace the physical S31 controller execution.
 *
 * Install once:
 *   npm install ws serialport
 *
 * Run:
 *   node tools/s31_hil_bridge.mjs --port /dev/ttyACM0
 *   node tools/s31_hil_bridge.mjs --port COM5
 *
 * By default the bridge fetches the currently deployed self-contained page:
 *   https://kurzlernen.de/drone_simulator.html
 *
 * For a fully offline setup, point --html at a self-contained built artifact:
 *   node tools/s31_hil_bridge.mjs --port COM5 --html ./drone_simulator.built.html
 */

import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { WebSocketServer, WebSocket } from "ws";
import { SerialPort } from "serialport";

const INPUT_BYTES = 64;
const OUTPUT_BYTES = 32;
const INPUT_MAGIC = "HIL1";
const OUTPUT_MAGIC = "HLO1";
const DEFAULT_SITE = "https://kurzlernen.de/drone_simulator.html";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function crc32(buffer, length = buffer.length) {
  let crc = 0xffffffff;
  for (let i = 0; i < length; ++i) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; ++bit) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validateInputPacket(packet) {
  if (!Buffer.isBuffer(packet)) packet = Buffer.from(packet);
  if (packet.length !== INPUT_BYTES) throw new Error(`Expected ${INPUT_BYTES}-byte HIL1 packet`);
  if (packet.subarray(0, 4).toString("ascii") !== INPUT_MAGIC) throw new Error("Invalid HIL1 magic");
  const expected = packet.readUInt32LE(60);
  const actual = crc32(packet, 60);
  if (actual !== expected) throw new Error("HIL1 CRC mismatch");
  return packet.readUInt32LE(4);
}

function validateOutputPacket(packet, expectedSequence) {
  if (!Buffer.isBuffer(packet)) packet = Buffer.from(packet);
  if (packet.length !== OUTPUT_BYTES) throw new Error(`Expected ${OUTPUT_BYTES}-byte HLO1 packet`);
  if (packet.subarray(0, 4).toString("ascii") !== OUTPUT_MAGIC) throw new Error("Physical S31 returned invalid HLO1 magic");
  const sequence = packet.readUInt32LE(4);
  if (sequence !== expectedSequence) throw new Error(`HLO1 sequence mismatch: expected ${expectedSequence}, got ${sequence}`);
  const expectedCrc = packet.readUInt32LE(28);
  const actualCrc = crc32(packet, 28);
  if (actualCrc !== expectedCrc) throw new Error("Physical S31 returned invalid HLO1 CRC");
}

function lanAddresses() {
  const result = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) result.push(entry.address);
    }
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

function validateBuiltHtml(html, sourceDescription) {
  if (!html.includes("Arondight45 Drone Digital Twin")) throw new Error(`${sourceDescription} is not the Arondight45 simulator`);
  if (!html.includes("Export run")) throw new Error(`${sourceDescription} is an old simulator build`);
  if (!html.includes("functional HIL")) throw new Error(`${sourceDescription} does not contain the functional-HIL build marker`);
  if (/src=["']\.\/sim\/simulator\.mjs["']/.test(html)) throw new Error(`${sourceDescription} is unbuilt source HTML, not the self-contained artifact`);
  if (html.includes("generated/flight_core.mjs")) throw new Error(`${sourceDescription} still depends on an external generated WASM module`);
  if (!/<script\s+type=["']module["']>/.test(html)) throw new Error(`${sourceDescription} has no inline bundled module`);
  return html;
}

async function loadSimulatorHtml() {
  const localPath = option("--html");
  if (localPath) {
    const resolved = path.resolve(localPath);
    return validateBuiltHtml(await fs.readFile(resolved, "utf8"), resolved);
  }

  const site = option("--site", DEFAULT_SITE);
  const response = await fetch(site, {
    redirect: "follow",
    headers: { "User-Agent": "Arondight45-S31-HIL-Bridge/1" },
  });
  if (!response.ok) throw new Error(`Cannot fetch built simulator ${site}: HTTP ${response.status}`);
  return validateBuiltHtml(await response.text(), site);
}

class SerialExchange {
  constructor(port) {
    this.port = port;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.chain = Promise.resolve();
    port.on("data", chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.flush();
    });
    port.on("error", error => this.rejectAll(error));
    port.on("close", () => this.rejectAll(new Error("S31 serial port closed")));
  }

  flush() {
    while (this.waiters.length && this.buffer.length >= this.waiters[0].count) {
      const waiter = this.waiters.shift();
      const data = this.buffer.subarray(0, waiter.count);
      this.buffer = this.buffer.subarray(waiter.count);
      clearTimeout(waiter.timer);
      waiter.resolve(data);
    }
  }

  rejectAll(error) {
    while (this.waiters.length) {
      const waiter = this.waiters.shift();
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  readExact(count, timeoutMs = 2000) {
    if (this.buffer.length >= count) {
      const data = this.buffer.subarray(0, count);
      this.buffer = this.buffer.subarray(count);
      return Promise.resolve(data);
    }

    return new Promise((resolve, reject) => {
      const waiter = { count, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`S31 response timeout: ${count} bytes expected`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  exchange(rawPacket) {
    const packet = Buffer.isBuffer(rawPacket) ? rawPacket : Buffer.from(rawPacket);
    const sequence = validateInputPacket(packet);

    const operation = this.chain.catch(() => undefined).then(async () => {
      this.buffer = Buffer.alloc(0);
      await new Promise((resolve, reject) => this.port.write(packet, error => error ? reject(error) : resolve()));
      await new Promise((resolve, reject) => this.port.drain(error => error ? reject(error) : resolve()));
      const response = await this.readExact(OUTPUT_BYTES);
      validateOutputPacket(response, sequence);
      return response;
    });

    this.chain = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

const simulatorHtml = await loadSimulatorHtml();
const simulatorBytes = Buffer.from(simulatorHtml, "utf8");
const serialPath = await choosePort(option("--port"));
const baudRate = Number(option("--baud", "2000000"));
const httpPort = Number(option("--http-port", "8765"));
if (!Number.isInteger(baudRate) || baudRate <= 0) throw new Error("--baud must be a positive integer");
if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) throw new Error("--http-port must be 1..65535");

const serial = new SerialPort({ path: serialPath, baudRate, autoOpen: false });
await new Promise((resolve, reject) => serial.open(error => error ? reject(error) : resolve()));
const exchange = new SerialExchange(serial);

const server = http.createServer((request, response) => {
  const requested = new URL(request.url || "/", "http://localhost").pathname;
  if (requested === "/" || requested === "/drone_simulator.html") {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Length": simulatorBytes.length,
      "X-Content-Type-Options": "nosniff",
    });
    response.end(simulatorBytes);
    return;
  }
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  response.end("Not found\n");
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: INPUT_BYTES });
server.on("upgrade", (request, socket, head) => {
  if (new URL(request.url || "/", "http://localhost").pathname !== "/hil") {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, ws => sockets.emit("connection", ws, request));
});

let activeClient = null;
sockets.on("connection", (ws, request) => {
  const peer = request.socket.remoteAddress;
  if (activeClient && activeClient.readyState === WebSocket.OPEN) {
    ws.close(1013, "one HIL client at a time");
    return;
  }
  activeClient = ws;
  console.log(`HIL client connected: ${peer}`);

  ws.on("message", async (data, binary) => {
    if (!binary) {
      ws.close(1003, "binary HIL packets required");
      return;
    }
    try {
      const response = await exchange.exchange(Buffer.from(data));
      if (ws.readyState === WebSocket.OPEN) ws.send(response, { binary: true });
    } catch (error) {
      console.error(`HIL exchange failed: ${error.message}`);
      if (ws.readyState === WebSocket.OPEN) ws.close(1011, error.message.slice(0, 120));
    }
  });

  ws.on("close", () => {
    if (activeClient === ws) activeClient = null;
    console.log(`HIL client disconnected: ${peer}`);
  });
});

server.listen(httpPort, "0.0.0.0", () => {
  console.log(`Physical S31: ${serialPath} at ${baudRate} baud`);
  console.log(`Self-contained simulator loaded: ${simulatorBytes.length} bytes`);
  console.log(`Open locally: http://127.0.0.1:${httpPort}/`);
  for (const address of lanAddresses()) console.log(`Open on iPhone/LAN: http://${address}:${httpPort}/`);
  console.log("Bridge policy: byte forwarding only; all flight-controller math remains on the physical S31.");
});

function shutdown() {
  console.log("\nStopping S31 HIL bridge.");
  activeClient?.close(1001, "bridge shutting down");
  sockets.close();
  server.close(() => serial.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
