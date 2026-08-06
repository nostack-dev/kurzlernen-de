#!/usr/bin/env node
/*
 * Arondight45 S31 HIL LAN bridge.
 *
 * The bridge serves drone_simulator.html and forwards binary HIL1/HLO1 packets
 * between a browser WebSocket and the physical ESP32-S31 USB serial port.
 * It performs no flight-control computation.
 *
 * Install once:
 *   npm install ws serialport
 *
 * Run from the repository root:
 *   node tools/s31_hil_bridge.mjs --port /dev/ttyACM0
 *   node tools/s31_hil_bridge.mjs --port COM5
 *
 * Then open the printed http://<LAN-IP>:8765/ URL on the iPhone.
 */
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { SerialPort } from "serialport";

const INPUT_BYTES = 64;
const OUTPUT_BYTES = 32;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  })[ext] || "application/octet-stream";
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
      const timer = setTimeout(() => reject(new Error(`S31 response timeout: ${count} bytes expected`)), timeoutMs);
      this.waiters.push({ count, resolve, reject, timer });
    });
  }

  exchange(packet) {
    this.chain = this.chain.then(async () => {
      if (!Buffer.isBuffer(packet)) packet = Buffer.from(packet);
      if (packet.length !== INPUT_BYTES || packet.subarray(0, 4).toString("ascii") !== "HIL1") {
        throw new Error("Expected one 64-byte HIL1 packet");
      }
      this.buffer = Buffer.alloc(0);
      await new Promise((resolve, reject) => this.port.write(packet, error => error ? reject(error) : resolve()));
      await new Promise((resolve, reject) => this.port.drain(error => error ? reject(error) : resolve()));
      const response = await this.readExact(OUTPUT_BYTES);
      if (response.subarray(0, 4).toString("ascii") !== "HLO1") throw new Error("Physical S31 returned invalid HLO1 magic");
      return response;
    });
    return this.chain;
  }
}

const serialPath = await choosePort(option("--port"));
const baudRate = Number(option("--baud", "2000000"));
const httpPort = Number(option("--http-port", "8765"));
const serial = new SerialPort({ path: serialPath, baudRate, autoOpen: false });
await new Promise((resolve, reject) => serial.open(error => error ? reject(error) : resolve()));
const exchange = new SerialExchange(serial);

const server = http.createServer(async (request, response) => {
  try {
    const requested = new URL(request.url || "/", "http://localhost").pathname;
    const relative = requested === "/" ? "drone_simulator.html" : decodeURIComponent(requested.slice(1));
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) && file !== root) throw new Error("invalid path");
    const data = await fs.readFile(file);
    response.writeHead(200, {
      "Content-Type": mime(file),
      "Cache-Control": "no-store",
      "Content-Length": data.length,
    });
    response.end(data);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
  }
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: INPUT_BYTES });
server.on("upgrade", (request, socket, head) => {
  if (new URL(request.url || "/", "http://localhost").pathname !== "/hil") {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, ws => sockets.emit("connection", ws, request));
});

sockets.on("connection", (ws, request) => {
  const peer = request.socket.remoteAddress;
  console.log(`HIL client connected: ${peer}`);
  ws.on("message", async (data, binary) => {
    if (!binary) {
      ws.close(1003, "binary HIL packets required");
      return;
    }
    try {
      const response = await exchange.exchange(Buffer.from(data));
      if (ws.readyState === ws.OPEN) ws.send(response, { binary: true });
    } catch (error) {
      console.error(`HIL exchange failed: ${error.message}`);
      ws.close(1011, error.message.slice(0, 120));
    }
  });
  ws.on("close", () => console.log(`HIL client disconnected: ${peer}`));
});

server.listen(httpPort, "0.0.0.0", () => {
  console.log(`Physical S31: ${serialPath} at ${baudRate} baud`);
  console.log(`Open locally: http://127.0.0.1:${httpPort}/`);
  for (const address of lanAddresses()) console.log(`Open on iPhone/LAN: http://${address}:${httpPort}/`);
  console.log("The bridge forwards bytes only; controller math remains on the S31.");
});

function shutdown() {
  console.log("\nStopping S31 HIL bridge.");
  sockets.close();
  server.close(() => serial.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
