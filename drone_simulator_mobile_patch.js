(() => {
  const serialSupported = "serial" in navigator;
  const connect = document.getElementById("connect");
  const serialState = document.getElementById("serialState");
  const panel = document.querySelector(".panel");
  const fatal = document.getElementById("fatal");

  if (serialSupported || !connect || !panel) return;

  if (fatal) fatal.style.display = "none";

  connect.disabled = true;
  connect.textContent = "Desktop Chrome/Edge required";
  connect.classList.remove("primary");

  if (serialState) {
    serialState.textContent = "UNSUPPORTED ON THIS DEVICE";
    serialState.className = "warn";
  }

  for (const id of ["start", "reset", "disconnect"]) {
    const element = document.getElementById(id);
    if (element) element.disabled = true;
  }

  const card = document.createElement("div");
  card.className = "card mobile-support-card";
  card.innerHTML = `
    <h2><strong>Physical S31 connection unavailable here</strong></h2>
    <div class="help">
      This iPhone browser does not expose the Web Serial API. The page therefore
      cannot communicate with the real ESP32-S31 and deliberately does not start
      a software flight-controller fallback.<br><br>
      Open this URL on a desktop computer in Chrome or Edge, connect the flashed
      S31 over USB, then press <b>Connect physical S31</b>.
    </div>`;

  const firstCard = panel.querySelector(".card");
  panel.insertBefore(card, firstCard || null);

  connect.addEventListener(
    "click",
    event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    true
  );
})();
