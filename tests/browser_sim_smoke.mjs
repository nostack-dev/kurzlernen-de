import puppeteer from "puppeteer-core";

const url = process.argv[2] || "http://127.0.0.1:4173/drone_simulator.html";
const executablePath = process.env.CHROME_BIN;
if (!executablePath) throw new Error("CHROME_BIN must point to Chrome/Chromium");

const browser = await puppeteer.launch({
  headless: true,
  executablePath,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-gl=angle",
    "--use-angle=swiftshader",
  ],
});

const page = await browser.newPage();
const errors = [];
const externalRequests = [];
page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
page.on("console", message => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("request", request => {
  const requestUrl = new URL(request.url());
  if (requestUrl.hostname !== "127.0.0.1" && requestUrl.hostname !== "localhost") {
    externalRequests.push(request.url());
  }
});

async function text(selector) {
  return page.$eval(selector, element => element.textContent || "");
}

async function waitForText(selector, predicate, timeout = 15000) {
  await page.waitForFunction(
    (sel, source) => {
      const element = document.querySelector(sel);
      if (!element) return false;
      return Function("value", `return (${source})(value)`)(element.textContent || "");
    },
    { timeout },
    selector,
    predicate.toString(),
  );
}

try {
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "load", timeout: 30000 });

  await waitForText("#status", value => value.includes("SIM ready"), 30000);
  const boot = await page.evaluate(() => ({
    title: document.title,
    status: document.querySelector("#status")?.textContent || "",
    controller: document.querySelector("#tController")?.textContent || "",
    externalScripts: [...document.scripts].filter(script => script.src).map(script => script.src),
    canvasCount: document.querySelectorAll("canvas").length,
    mode: document.querySelector("#tMode")?.textContent || "",
  }));

  if (boot.title !== "Arondight45 Drone Digital Twin") throw new Error(`unexpected title: ${boot.title}`);
  if (!boot.status.includes("SIM ready")) throw new Error(`SIM did not boot: ${boot.status}`);
  if (!boot.controller.includes("shared fc::Runtime / WASM")) throw new Error(`wrong controller backend: ${boot.controller}`);
  if (boot.externalScripts.length) throw new Error(`built HTML still has external scripts: ${boot.externalScripts.join(", ")}`);
  if (boot.canvasCount < 1) throw new Error("Three.js WebGL canvas was not created");
  if (boot.mode !== "SIM") throw new Error(`SIM is not the default mode: ${boot.mode}`);
  if (externalRequests.length) throw new Error(`self-contained simulator made external requests: ${externalRequests.join(", ")}`);

  await page.click("#run");
  await page.waitForFunction(() => parseFloat(document.querySelector("#simTime")?.textContent || "0") > 0.05, { timeout: 10000 });
  await waitForText("#fcState", value => value === "DISARMED", 15000);

  // Production arming contract: the runtime has already observed ARM LOW after
  // calibration; switch HIGH and hold for one full simulated second.
  await page.keyboard.press("Space");
  await waitForText("#fcState", value => value === "ARMED", 15000);

  const armed = await page.evaluate(() => ({
    state: document.querySelector("#fcState")?.textContent || "",
    motors: (document.querySelector("#motors")?.textContent || "").trim().split(/\s+/).map(Number),
    rpm: (document.querySelector("#rpm")?.textContent || "").trim().split(/\s+/).map(Number),
  }));
  if (armed.state !== "ARMED") throw new Error(`arming failed: ${armed.state}`);
  if (!armed.motors.every(value => value === 1050)) throw new Error(`armed idle pulses are wrong: ${armed.motors.join(" ")}`);

  // The physics model must treat 1050 us as armed idle, not zero voltage.
  await new Promise(resolve => setTimeout(resolve, 500));
  const idleRpm = await page.$eval("#rpm", element => (element.textContent || "").trim().split(/\s+/).map(Number));
  if (!idleRpm.every(value => Number.isFinite(value) && value > 0)) throw new Error(`1050 us produced zero/invalid idle RPM: ${idleRpm.join(" ")}`);

  await page.$eval("#touchThrottle", element => { element.value = "0.25"; });
  await new Promise(resolve => setTimeout(resolve, 500));
  const throttleMotors = await page.$eval("#motors", element => (element.textContent || "").trim().split(/\s+/).map(Number));
  if (!throttleMotors.every(value => Number.isFinite(value) && value > 1050)) throw new Error(`throttle did not raise motor pulses: ${throttleMotors.join(" ")}`);

  // Re-check the responsive layout using the exact same built artifact.
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await new Promise(resolve => setTimeout(resolve, 250));
  const mobile = await page.evaluate(() => {
    const panel = document.querySelector(".panel").getBoundingClientRect();
    const telemetry = document.querySelector(".telemetry").getBoundingClientRect();
    return {
      panelBottom: panel.bottom,
      telemetryTop: telemetry.top,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyOverflowY: getComputedStyle(document.body).overflowY,
    };
  });
  if (mobile.telemetryTop < mobile.panelBottom - 1) throw new Error(`mobile panels overlap: panel bottom ${mobile.panelBottom}, telemetry top ${mobile.telemetryTop}`);
  if (mobile.scrollWidth > mobile.clientWidth + 1) throw new Error(`mobile horizontal overflow: ${mobile.scrollWidth} > ${mobile.clientWidth}`);
  if (mobile.bodyOverflowY === "hidden") throw new Error("mobile page is not vertically scrollable");

  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Browser SIL E2E passed: self-contained boot, calibration, arm, idle RPM, throttle, responsive layout.");
} finally {
  await browser.close();
}
