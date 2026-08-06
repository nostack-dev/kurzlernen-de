const serialSupported = "serial" in navigator;
const connect = document.getElementById("connect");
const disconnect = document.getElementById("disconnect");
const start = document.getElementById("start");
const reset = document.getElementById("reset");
const serialState = document.getElementById("serialState");
const panel = document.querySelector(".panel");
const fatal = document.getElementById("fatal");
const fatalText = document.getElementById("fatalText");

function dismissUnsupportedFatal() {
  if (!fatal || !fatalText) return;
  const message = fatalText.textContent || "";
  if (/WebSerial|desktop Chrome|desktop Edge|serial is unavailable/i.test(message)) {
    fatal.style.display = "none";
    fatalText.textContent = "";
  }
}

function installMobileHardwareNotice() {
  if (serialSupported || !connect || !panel) return;

  dismissUnsupportedFatal();

  connect.disabled = true;
  connect.textContent = "USB unavailable on this device";
  connect.classList.remove("primary");
  connect.setAttribute("aria-disabled", "true");

  for (const element of [disconnect, start, reset]) {
    if (element) element.disabled = true;
  }

  if (serialState) {
    serialState.textContent = "USE PHYSICAL S31 BRIDGE";
    serialState.className = "warn";
  }

  if (!document.getElementById("mobileHardwareNotice")) {
    const card = document.createElement("div");
    card.id = "mobileHardwareNotice";
    card.className = "card mobile-support-card";
    card.innerHTML = `
      <h2>Real S31 connection on iPhone</h2>
      <div class="help">
        iOS does not expose USB serial to websites. This is not treated as a simulator crash anymore.
        The zero-cheat controller still has to run on the physical ESP32-S31, connected through a
        desktop or Raspberry Pi bridge. Open this simulator on desktop Chrome/Edge for direct USB.
      </div>
    `;
    const firstCard = panel.querySelector(".card");
    if (firstCard) panel.insertBefore(card, firstCard);
    else panel.appendChild(card);
  }
}

if (!serialSupported && connect) {
  connect.addEventListener(
    "click",
    event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      installMobileHardwareNotice();
    },
    true,
  );
}

if (fatal) {
  new MutationObserver(dismissUnsupportedFatal).observe(fatal, {
    attributes: true,
    childList: true,
    subtree: true,
  });
}

installMobileHardwareNotice();
requestAnimationFrame(installMobileHardwareNotice);