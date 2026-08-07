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
  if (requestUrl.hostname !== "127.0.0.1" && requestUrl.hostname !== "localhost") externalRequests.push(request.url());
});

async function waitForText(selector, predicate, timeout = 15000) {
  await page.waitForFunction(
    (sel, source) => {
      const element = document.querySelector(sel);
      if (!element) return false;
      return Function("value", `return (${source})(value)`)(element.textContent || "");
    },
    { timeout }, selector, predicate.toString(),
  );
}

async function simTime() {
  return page.$eval("#simTime", element => parseFloat(element.textContent || "0"));
}

async function waitForSimTime(target, timeout = 60000) {
  await page.waitForFunction(
    targetTime => parseFloat(document.querySelector("#simTime")?.textContent || "0") >= targetTime,
    { timeout }, target,
  );
}

async function snapshot() {
  return page.evaluate(() => ({
    simTime: document.querySelector("#simTime")?.textContent || "",
    state: document.querySelector("#fcState")?.textContent || "",
    status: document.querySelector("#status")?.textContent || "",
    motors: document.querySelector("#motors")?.textContent || "",
    rpm: document.querySelector("#rpm")?.textContent || "",
    attitude: document.querySelector("#attitude")?.textContent || "",
    throttle: document.querySelector("#throttle")?.textContent || "",
  }));
}

async function dragStick(selector, normalizedX, normalizedY) {
  const box = await page.$eval(selector, element => {
    const r = element.getBoundingClientRect();
    return {x:r.left,y:r.top,width:r.width,height:r.height};
  });
  const radius = Math.min(box.width, box.height) * 0.42;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + radius * normalizedX, cy + radius * normalizedY, {steps:4});
  await page.mouse.up();
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

  const cameraBoot = await page.evaluate(() => ({
    mode: document.querySelector("#viewport")?.dataset.cameraMode || "",
    follow: document.querySelector("#camFollow")?.dataset.active || "",
    fpv: document.querySelector("#camFpv")?.dataset.active || "",
  }));
  if (cameraBoot.mode !== "follow" || cameraBoot.follow !== "1") throw new Error(`FOLLOW camera is not default: ${JSON.stringify(cameraBoot)}`);
  await page.click("#camFpv");
  const fpvMode = await page.$eval("#viewport", element => element.dataset.cameraMode || "");
  if (fpvMode !== "fpv") throw new Error(`FPV camera switch failed: ${fpvMode}`);
  await page.click("#camFollow");
  const followMode = await page.$eval("#viewport", element => element.dataset.cameraMode || "");
  if (followMode !== "follow") throw new Error(`FOLLOW camera switch failed: ${followMode}`);
  const soloUi = await page.evaluate(() => ({soloButton:!!document.querySelector("#camSolo"),soloHud:!!document.querySelector("#soloHud"),left:!!document.querySelector("#soloLeft"),right:!!document.querySelector("#soloRight"),arm:!!document.querySelector("#soloArm"),kill:!!document.querySelector("#soloKill")}));
  if (!Object.values(soloUi).every(Boolean)) throw new Error(`single-phone HUD incomplete: ${JSON.stringify(soloUi)}`);

  // Single-phone mode must use the exact same stick and arm semantics as the paired controller.
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1 });
  await page.click("#camSolo");
  await page.waitForFunction(() => document.body.classList.contains("solo-flight"), {timeout:5000});
  const soloStart = await page.evaluate(() => ({
    input: document.querySelector("#inputSource")?.value || "",
    hidden: document.querySelector("#soloHud")?.hidden,
    leftTop: parseFloat(document.querySelector("#soloLeft .solo-knob")?.style.top || "0"),
  }));
  if (soloStart.input !== "local" || soloStart.hidden || soloStart.leftTop < 90) throw new Error(`single-phone neutral state is wrong: ${JSON.stringify(soloStart)}`);

  await waitForSimTime(2.2, 60000);
  let soloState = await page.$eval("#fcState", element => element.textContent || "");
  if (soloState !== "DISARMED") throw new Error(`single-phone calibration failed: ${JSON.stringify(await snapshot())}`);

  // Same paired-controller throttle behavior: left stick release centers yaw but retains throttle.
  await dragStick("#soloLeft", 0.35, 0.5);
  await new Promise(resolve => setTimeout(resolve, 100));
  const retained = await page.evaluate(() => ({
    throttle: parseFloat(document.querySelector("#throttle")?.textContent || "0"),
    armDisabled: document.querySelector("#soloArm")?.disabled,
    left: document.querySelector("#soloLeft .solo-knob")?.style.left || "",
    top: document.querySelector("#soloLeft .solo-knob")?.style.top || "",
  }));
  if (Math.abs(retained.throttle - 25) > 1.5) throw new Error(`single-phone throttle did not retain 25% after stick release: ${JSON.stringify(retained)}`);
  if (!retained.armDisabled) throw new Error(`single-phone ARM was not blocked with throttle raised: ${JSON.stringify(retained)}`);
  if (Math.abs(parseFloat(retained.left) - 50) > 1) throw new Error(`single-phone yaw did not center on left-stick release: ${JSON.stringify(retained)}`);

  await dragStick("#soloLeft", 0, 1);
  await new Promise(resolve => setTimeout(resolve, 100));
  const neutralAgain = await page.evaluate(() => ({
    throttle: parseFloat(document.querySelector("#throttle")?.textContent || "0"),
    armDisabled: document.querySelector("#soloArm")?.disabled,
  }));
  if (neutralAgain.throttle > 0.5 || neutralAgain.armDisabled) throw new Error(`single-phone neutral/ARM gate mismatch: ${JSON.stringify(neutralAgain)}`);

  const soloArmStart = await simTime();
  await page.click("#soloArm");
  await waitForSimTime(soloArmStart + 1.1, 45000);
  soloState = await page.$eval("#fcState", element => element.textContent || "");
  if (soloState !== "ARMED") throw new Error(`single-phone ARM did not use production arming path: ${JSON.stringify(await snapshot())}`);
  const soloMotors = await page.$eval("#motors", element => (element.textContent || "").trim().split(/\s+/).map(Number));
  if (!soloMotors.every(value => value === 1050)) throw new Error(`single-phone armed idle differs from paired path: ${soloMotors.join(" ")}`);

  await page.click("#soloKill");
  const killStart = await simTime();
  await waitForSimTime(killStart + 0.05, 10000);
  soloState = await page.$eval("#fcState", element => element.textContent || "");
  const killedMotors = await page.$eval("#motors", element => (element.textContent || "").trim().split(/\s+/).map(Number));
  if (soloState !== "DISARMED" || !killedMotors.every(value => value === 1000)) throw new Error(`single-phone KILL failed: ${JSON.stringify(await snapshot())}`);
  await page.evaluate(() => document.querySelector("#soloExit")?.click());
  await page.waitForFunction(() => !document.body.classList.contains("solo-flight"), {timeout:5000});
  await page.click("#reset");
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

  // Standalone local fallback remains independently usable.
  await page.select("#inputSource", "local");
  await page.$eval("#inputSource", element => element.dispatchEvent(new Event("change", { bubbles: true })));

  await page.click("#run");
  await waitForSimTime(0.05, 10000);
  await waitForSimTime(2.2, 60000);
  let state = await page.$eval("#fcState", element => element.textContent || "");
  if (state !== "DISARMED") throw new Error(`after 2.2 simulated seconds calibration is not complete: ${JSON.stringify(await snapshot())}`);

  const armStartedAt = await simTime();
  await page.keyboard.press("Space");
  await waitForSimTime(armStartedAt + 1.1, 45000);
  state = await page.$eval("#fcState", element => element.textContent || "");
  if (state !== "ARMED") throw new Error(`arming failed after >1.0 simulated second: ${JSON.stringify(await snapshot())}`);

  const armed = await page.evaluate(() => ({
    state: document.querySelector("#fcState")?.textContent || "",
    motors: (document.querySelector("#motors")?.textContent || "").trim().split(/\s+/).map(Number),
    rpm: (document.querySelector("#rpm")?.textContent || "").trim().split(/\s+/).map(Number),
  }));
  if (!armed.motors.every(value => value === 1050)) throw new Error(`armed idle pulses are wrong: ${armed.motors.join(" ")}`);

  const idleStart = await simTime();
  await waitForSimTime(idleStart + 0.15, 15000);
  const idleRpm = await page.$eval("#rpm", element => (element.textContent || "").trim().split(/\s+/).map(Number));
  if (!idleRpm.every(value => Number.isFinite(value) && value > 0)) throw new Error(`1050 us produced zero/invalid idle RPM: ${idleRpm.join(" ")}`);

  await page.$eval("#touchThrottle", element => { element.value = "0.25"; });
  const throttleStart = await simTime();
  await waitForSimTime(throttleStart + 0.1, 15000);
  const throttleMotors = await page.$eval("#motors", element => (element.textContent || "").trim().split(/\s+/).map(Number));
  if (!throttleMotors.every(value => Number.isFinite(value) && value > 1050)) throw new Error(`throttle did not raise motor pulses: ${throttleMotors.join(" ")}`);

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
  console.log("Browser SIL E2E passed: daylight scene, FOLLOW/FPV cameras, paired-equivalent single-phone controls, calibration, ARM/KILL, idle RPM, local fallback, throttle and responsive layout.");
} finally {
  await browser.close();
}
