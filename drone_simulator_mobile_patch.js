const bridgeShim = Boolean(navigator.serial?.__arondightBridgeShim);
const nativeSerial = "serial" in navigator && !bridgeShim;
const connect = document.getElementById("connect");
const disconnect = document.getElementById("disconnect");
const start = document.getElementById("start");
const reset = document.getElementById("reset");
const serialState = document.getElementById("serialState");
const panel = document.querySelector(".panel");
const fatal = document.getElementById("fatal");
const fatalText = document.getElementById("fatalText");
const servedByLanBridge = bridgeShim && location.protocol === "http:" && Boolean(location.port);

function dismissTransportFatal() {
  if (!fatal || !fatalText) return;
  const message = fatalText.textContent || "";
  if (/WebSerial|desktop Chrome|desktop Edge|serial is unavailable|LAN bridge|ws:\/\//i.test(message)) {
    fatal.style.display = "none";
    fatalText.textContent = "";
  }
}

function addNotice({ title, message }) {
  if (!panel) return;
  let card = document.getElementById("mobileHardwareNotice");
  if (!card) {
    card = document.createElement("div");
    card.id = "mobileHardwareNotice";
    card.className = "card mobile-support-card";
    const firstCard = panel.querySelector(".card");
    if (firstCard) panel.insertBefore(card, firstCard);
    else panel.appendChild(card);
  }
  card.innerHTML = `<h2>${title}</h2><div class="help">${message}</div>`;
}

function configureTransportUi() {
  dismissTransportFatal();

  if (nativeSerial) return;

  if (bridgeShim && servedByLanBridge) {
    connect.disabled = false;
    connect.textContent = "Connect physical S31 bridge";
    connect.classList.add("primary");
    if (serialState) {
      serialState.textContent = "LAN BRIDGE READY";
      serialState.className = "good";
    }
    addNotice({
      title: "Real S31 over LAN",
      message:
        "This page is being served by the S31 bridge. Press connect: every HIL packet is forwarded to the physical ESP32-S31; no controller runs in the browser.",
    });
    return;
  }

  connect.disabled = false;
  connect.textContent = "How to connect the real S31";
  connect.classList.remove("primary");
  if (serialState) {
    serialState.textContent = "OPEN LAN BRIDGE URL";
    serialState.className = "warn";
  }
  for (const element of [disconnect, start, reset]) {
    if (element) element.disabled = true;
  }
  addNotice({
    title: "Real S31 connection on iPhone",
    message:
      "iOS exposes no USB serial API to websites. Run <code>npm install ws serialport</code>, then <code>node tools/s31_hil_bridge.mjs --port YOUR_S31_PORT</code> on the computer or Raspberry Pi holding the board. Open the printed <code>http://LAN-IP:8765/</code> address on this iPhone. That page connects to the physical S31 without a browser controller fallback.",
  });
}

if (!nativeSerial && !servedByLanBridge && connect) {
  connect.addEventListener(
    "click",
    event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      configureTransportUi();
      document.getElementById("mobileHardwareNotice")?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    true,
  );
}

if (fatal) {
  new MutationObserver(dismissTransportFatal).observe(fatal, {
    attributes: true,
    childList: true,
    subtree: true,
  });
}

configureTransportUi();
requestAnimationFrame(configureTransportUi);