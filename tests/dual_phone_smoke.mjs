import puppeteer from "puppeteer-core";

const base = process.argv[2] || "http://127.0.0.1:4174";
const executablePath = process.env.CHROME_BIN;
if (!executablePath) throw new Error("CHROME_BIN must point to Chrome/Chromium");

const commonArgs = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--enable-webgl",
  "--ignore-gpu-blocklist",
  "--use-gl=angle",
  "--use-angle=swiftshader",
];

// Two independent Chromium processes are intentional. Two tabs in one browser
// are not equivalent to two phones: Chrome may throttle background timers and
// requestAnimationFrame, which can manufacture remote-control stale events.
const viewBrowser = await puppeteer.launch({headless:true, executablePath, args:commonArgs});
const controllerBrowser = await puppeteer.launch({headless:true, executablePath, args:commonArgs});
const errors = [];

function watch(page,name) {
  page.on("pageerror", error => errors.push(`${name} pageerror: ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error") errors.push(`${name} console: ${message.text()}`);
  });
}
async function waitText(page,selector,needle,timeout=20000) {
  await page.waitForFunction(
    (sel,text) => document.querySelector(sel)?.textContent?.includes(text),
    {timeout}, selector, needle,
  );
}
async function simTime(page) {
  return page.$eval("#simTime", element => parseFloat(element.textContent || "0"));
}
async function waitSim(page,target,timeout=60000) {
  await page.waitForFunction(
    value => parseFloat(document.querySelector("#simTime")?.textContent || "0") >= value,
    {timeout}, target,
  );
}
async function viewSnapshot(page) {
  return page.evaluate(() => ({
    simTime: document.querySelector("#simTime")?.textContent || "",
    state: document.querySelector("#fcState")?.textContent || "",
    remote: document.querySelector("#remoteStatus")?.textContent || "",
    motors: document.querySelector("#motors")?.textContent || "",
  }));
}

const view = await viewBrowser.newPage();
const controller = await controllerBrowser.newPage();
watch(view,"view");
watch(controller,"controller");

try {
  await view.setViewport({width:844,height:390,deviceScaleFactor:1});
  await controller.setViewport({width:844,height:390,deviceScaleFactor:1});
  const room = "E2ETEST";

  await Promise.all([
    view.goto(`${base}/drone_simulator.html?room=${room}`, {waitUntil:"load",timeout:30000}),
    controller.goto(`${base}/drone_controller.html?room=${room}`, {waitUntil:"load",timeout:30000}),
  ]);
  await waitText(view,"#status","SIM ready",30000);
  await waitText(view,"#remoteStatus","REMOTE LINKED",20000);
  await waitText(controller,"#connection","SIM LINKED",20000);

  const viewSource = await view.$eval("#inputSource", element => element.value);
  if (viewSource !== "remote") throw new Error(`remote phone is not primary input: ${viewSource}`);
  console.log("Dual-phone E2E: two independent browser processes paired.");

  await view.click("#run");
  await waitSim(view,2.2,60000);
  let state = await view.$eval("#fcState", element => element.textContent || "");
  if (state !== "DISARMED") throw new Error(`dual-phone calibration failed: ${JSON.stringify(await viewSnapshot(view))}`);
  console.log("Dual-phone E2E: shared WASM runtime calibrated under remote control.");

  const armStart = await simTime(view);
  await controller.click("#arm");
  await waitSim(view,armStart+1.1,45000);
  state = await view.$eval("#fcState", element => element.textContent || "");
  if (state !== "ARMED") throw new Error(`remote arming failed: ${JSON.stringify(await viewSnapshot(view))}`);
  await waitText(controller,"#fcState","ARMED",10000);
  console.log("Dual-phone E2E: ARM command crossed relay and production arming gate.");

  // Left stick: yaw springs to center, throttle remains where released. Move it
  // to 25% throttle with centered yaw and release, exactly like a Mode-2 RC.
  const box = await controller.$eval("#leftStick", element => {
    const rect = element.getBoundingClientRect();
    return {x:rect.x,y:rect.y,w:rect.width,h:rect.height};
  });
  const cx = box.x + box.w/2;
  const cy = box.y + box.h/2;
  const radius = Math.min(box.w,box.h)*0.42;
  await controller.mouse.move(cx,cy+radius*0.5);
  await controller.mouse.down();
  await controller.mouse.up();

  const throttleStart = await simTime(view);
  await waitSim(view,throttleStart+0.12,20000);
  const pulses = await view.$eval("#motors", element =>
    (element.textContent || "").trim().split(/\s+/).map(Number));
  if (!pulses.every(value => Number.isFinite(value) && value > 1050)) {
    throw new Error(`remote throttle did not reach FC: ${pulses.join(" ")}`);
  }
  await controller.waitForFunction(() => {
    const text = document.querySelector("#motors")?.textContent || "";
    return text !== "—" && text.split(/\s+/).some(value => Number(value)>1050);
  }, {timeout:10000});
  console.log("Dual-phone E2E: throttle reached FC and telemetry returned to controller phone.");

  // Kill the entire controller browser process to model a lost/failed phone,
  // not a cooperative in-page Disconnect button. The view must independently
  // neutralize RC within its freshness window and the shared runtime must stop.
  await controllerBrowser.close();
  await new Promise(resolve => setTimeout(resolve,700));
  await view.waitForFunction(
    () => document.querySelector("#fcState")?.textContent === "DISARMED",
    {timeout:10000},
  );
  const safePulses = await view.$eval("#motors", element =>
    (element.textContent || "").trim().split(/\s+/).map(Number));
  if (!safePulses.every(value => value === 1000)) {
    throw new Error(`controller-loss fail-safe did not stop motors: ${safePulses.join(" ")}`);
  }
  const remoteStatus = await view.$eval("#remoteStatus", element => element.textContent || "");
  if (!/waiting|fail-safe|stale/i.test(remoteStatus)) {
    throw new Error(`view did not report controller loss: ${remoteStatus}`);
  }
  console.log("Dual-phone E2E: hard controller-process loss produced autonomous 1000-us disarm.");

  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Dual-phone E2E passed: two processes, pair, arm, throttle, telemetry, controller-loss disarm.");
} finally {
  try { await controllerBrowser.close(); } catch {}
  try { await viewBrowser.close(); } catch {}
}
