const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "stateBlueprintHotLinked.model.v2";

function defaultTestModel() {
  return {
    version: 2,
    name: "Standard Auth Flow",
    initial: "auth_start",
    states: [
      { id: "auth_start", title: "Auth start", body: "", components: [{ id: "c_auth_start", type: "text", text: "User chooses login or registration.", url: "" }], x: 90, y: 210 },
      { id: "login", title: "Login", body: "", components: [{ id: "c_login", type: "text", text: "Email and password are entered.", url: "" }], x: 360, y: 100 },
      { id: "register", title: "Register", body: "", components: [{ id: "c_register", type: "text", text: "Create a new account with email and accepted terms.", url: "" }], x: 360, y: 320 },
      { id: "error", title: "Error", body: "", components: [{ id: "c_error", type: "text", text: "Invalid credentials or registration data.", url: "" }], x: 630, y: 320 },
      { id: "logged_in", title: "Logged in", body: "", components: [{ id: "c_logged_in", type: "text", text: "Authenticated app area.", url: "" }], x: 900, y: 100 },
      { id: "logged_out", title: "Logged out", body: "", components: [{ id: "c_logged_out", type: "text", text: "Session ended. User can return to login.", url: "" }], x: 900, y: 320 }
    ],
    transitions: [
      { id: "t_auth_login", from: "auth_start", to: "login", label: "Login", condition: "", set: {} },
      { id: "t_auth_register", from: "auth_start", to: "register", label: "Registrieren", condition: "", set: {} },
      { id: "t_login_success", from: "login", to: "logged_in", label: "Einloggen", condition: "email == \"user@example.com\" && password == \"secret123\"", set: {} },
      { id: "t_login_error", from: "login", to: "error", label: "Fehler", condition: "", set: {} },
      { id: "t_register_success", from: "register", to: "logged_in", label: "Account erstellen", condition: "email == \"new@example.com\" && accepted_terms", set: {} },
      { id: "t_register_error", from: "register", to: "error", label: "Fehler", condition: "", set: {} },
      { id: "t_logout", from: "logged_in", to: "logged_out", label: "Logout", condition: "", set: {} },
      { id: "t_relogin", from: "logged_out", to: "login", label: "Wieder einloggen", condition: "", set: {} },
      { id: "t_error_back", from: "error", to: "auth_start", label: "Zurueck", condition: "", set: {} }
    ]
  };
}
function stateHtml() {
  return fs.readFileSync(path.join(process.cwd(), "state.html"), "utf8");
}

function extractJsString(source, declaration) {
  const marker = `${declaration} = "`;
  const start = source.indexOf(marker);
  expect(start, `${declaration} string exists`).toBeGreaterThanOrEqual(0);

  let raw = "";
  let escaped = false;
  for (let index = start + marker.length; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      raw += "\\" + char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") return JSON.parse(`"${raw}"`);
    raw += char;
  }
  throw new Error(`Could not find closing quote for ${declaration}`);
}

function generatedAppHtml() {
  return extractJsString(stateHtml(), "const APP_HTML");
}

function appFrame(page) {
  return page.frameLocator("#appFrame");
}

async function openStateInspector(page, id) {
  const node = page.locator('[data-id="' + id + '"]');
  await expect(node).toBeVisible();
  await node.hover();
  await node.locator(".node-edit").click({ force: true });
  await expect(page.locator("#pTitle")).toBeVisible();
}

async function openTool(page) {
  await page.addInitScript(({ key, model }) => {
    for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
      localStorage.removeItem(name);
    }
    localStorage.setItem(key, JSON.stringify(model));
  }, { key: STORAGE_KEY, model: defaultTestModel() });
  await page.goto("/state.html");
  await expect(page.locator('[data-id="auth_start"]')).toBeVisible();
}

async function openWithModel(page, model) {
  await page.addInitScript(({ key, model }) => {
    for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
      localStorage.removeItem(name);
    }
    localStorage.setItem(key, JSON.stringify(model));
  }, { key: STORAGE_KEY, model });
  await page.goto("/state.html");
  await expect(appFrame(page).locator("#statePill")).toHaveText(model.initial);
}

test.describe("Core source contracts", () => {
  test("APP_HTML string keeps nested script end tags escaped @smoke", () => {
    const html = stateHtml();
    const marker = 'const APP_HTML = "';
    const start = html.indexOf(marker);
    expect(start, "APP_HTML declaration exists").toBeGreaterThanOrEqual(0);
    const appUrlIndex = html.indexOf('const APP_URL', start);
    expect(appUrlIndex, "APP_URL follows APP_HTML").toBeGreaterThan(start);
    const rawLiteral = html.slice(start, appUrlIndex);

    expect(rawLiteral).toContain('<\\/script>');
    expect(rawLiteral).not.toContain('</script>');
  });

  test("generated self-contained app script stays syntactically valid @smoke", () => {
    const appHtml = generatedAppHtml();
    const scripts = [...appHtml.matchAll(/<script>\s*([\s\S]*?)<\/script>/gi)].map(match => match[1]);

    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(() => new Function(script)).not.toThrow();
    }
  });

  test("state tool text stays UTF-8 clean @smoke", () => {
    const html = stateHtml();
    const mojibakePattern = new RegExp("[\\u00c2\\u00c3\\ufffd]|\\u00e2(?:[\\u0080-\\u00bf]|[^\\x00-\\x7f])");

    expect(html).not.toMatch(mojibakePattern);
  });

  test("generated blank runtime starts without editor-only helpers @smoke", async ({ page }) => {
    await page.goto("/state.html");
    await page.evaluate(key => localStorage.removeItem(key), STORAGE_KEY);

    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));

    const appUrl = await page.evaluate(html => URL.createObjectURL(new Blob([html], { type: "text/html" })), generatedAppHtml());
    await page.goto(appUrl);
    await expect(page.locator("#appName")).toHaveText("Untitled Flow");
    expect(pageErrors).toEqual([]);
  });

  test("generated runtime keeps user content clean and event-driven @smoke", () => {
    const appHtml = generatedAppHtml();
    const actionHandler = appHtml.match(/button\.onclick = \(\) => \{[\s\S]*?\n\s*\};/);
    const html = stateHtml();

    expect(appHtml).not.toContain("No outgoing transitions");
    expect(appHtml).not.toContain("Play default chime");
    expect(appHtml).not.toContain("{{");
    expect(html).not.toContain("{{");
    expect(html).not.toContain("legacyDefaultTransitionEvent");
    expect(html).not.toContain('text: "{{fetch.data}}"');
    expect(html).not.toContain('text: "{{item}}"');
    expect(html).not.toContain('text: "Item: {{item}}"');
    expect(actionHandler?.[0] || "").toContain("emitRuntimeEvent");
    expect(actionHandler?.[0] || "").not.toContain("followTransition");
  });

  test("generated runtime keeps normal Next transitions visible as buttons @smoke", () => {
    const html = stateHtml();
    const appHtml = generatedAppHtml();

    expect(appHtml).toContain("function transitionIsButtonAction");
    expect(appHtml).toContain("const actionTransitions = transitions.filter(transitionIsButtonAction)");
    expect(html).toContain("function defaultTransitionLabel");
    expect(html).toContain("label: defaultTransitionLabel({ from: connecting.from, to: targetId })");
    expect(appHtml).toContain("function runtimeTransitionLabel");
    expect(appHtml).toContain("button.textContent = runtimeTransitionLabel(t)");
    expect(appHtml).toContain("function runtimeTransitionHue");
    expect(appHtml).toContain("applyRuntimeTransitionButtonStyle(button, t)");
  });

  test("list item editors use non-overlapping layout classes @smoke", () => {
    const html = stateHtml();

    expect(html).toContain('itemHead.className = "list-item-head"');
    expect(html).toContain('textField.className = "field list-item-field"');
    expect(html).toContain('urlField.className = "field list-item-field"');
    expect(html).toContain(".list-item-head");
    expect(html).toContain("grid-template-columns: minmax(0, 1fr) auto");
  });

  test("component data rendering stays wired through global-state paths @smoke", () => {
    const html = stateHtml();

    expect(html).toContain(".global-state-json");
    expect(html).toContain(".global-state-json-toggle");
    expect(html).toContain(".data-wire-row");
    expect(html).toContain("Render mapping");
    expect(html).toContain("Global State JSON");
    expect(html).toContain(".component-editor input");
    expect(html).toContain("function normalizeBindingPath");
    expect(html).toContain("function dataWireDisplayValue");
    expect(html).toContain("function dataWireUrlValue");
    expect(html).not.toContain(".template-binding-picker");
    expect(html).not.toContain("const connectTemplateBinding");
    expect(html).not.toContain("Connect data...");
    expect(html).toContain('const key = normalizeBindingPath(path, "");');
  });

  test("repeat sources offer readable candidates without auto-mapping render rows @smoke", () => {
    const html = stateHtml();
    const appHtml = generatedAppHtml();

    expect(html).toContain("function derivedRepeatComponents");
    expect(html).toContain("function pickDerivedRepeatFields");
    expect(html).toContain("function imagePathSpecificityScore");
    expect(html).toContain("category|categories|brand|manufacturer");
    expect(appHtml).toContain("function runtimeImagePathSpecificityScore");
    expect(appHtml).toContain("runtimeImagePathSpecificityScore(path)");
    expect(html).toContain("function repeatSampleForPath");
    expect(html).toContain("function repeatComponentMeta");
    expect(html).toContain("function columnarRepeatEntries");
    expect(html).toContain("function columnarRepeatItems");
    expect(html).toContain("function repeatValueItems");
    expect(html).toContain("isColumnarRepeatObject(value)");
    expect(html).toContain("function repeatCandidateDataScore");
    expect(html).toContain("function collectRepeatArrayCandidates");
    expect(html).toContain("function repeatCandidatesForOwner");
    expect(html).toContain("function autoRepeatPathForOwner");
    expect(html).toContain("manual: Boolean(source.manual)");
    expect(html).toContain("fetch response assumption");
    expect(html).toContain("function applyDerivedDataWires");
    expect(html).toContain("function dataWiresFromRepeatSample");
    expect(html).toContain("generatedFromDataWire");
    expect(html).not.toContain("Auto data part");
    expect(html).toContain("Render mapping");
    expect(html).toContain("applyDerivedDataWires");
    expect(html).toContain("upsertDataWire");
    expect(html).toContain("runtimeDataWireComponentsForState");
    expect(html).toContain("Listen werden aus dem State-Daten-Scope");
    expect(html).not.toContain("autoCreateRepeatComponents");
    expect(html).not.toContain("autoDeriveRepeatForOwner(s, null, false)");
    expect(html).not.toContain("applyDerivedDataWires(s, repeat.path, root, false)");
    expect(html).not.toContain("Fetch automap");
    expect(html).not.toContain("Open fetch automap");
    expect(html).toContain("dataWiresFromRepeatSample(sample, scopePath)");
    expect(html).toContain("push(fields.image, \"image\", \"image\", \"Image\")");
    expect(html).toContain('filter(part => !/^\\d+$/.test(part))');
    expect(html).toContain('const childPrefix = prefix ? prefix + ".0" : "";');
    expect(appHtml).toContain("function runtimeDerivedRepeatComponents");
    expect(appHtml).toContain("function runtimeColumnarRepeatEntries");
    expect(appHtml).toContain("function runtimeRepeatValueItems");
    expect(appHtml).toContain("const repeated = runtimeRepeatValueItems(repeatedValue)");
    expect(appHtml).toContain("function runtimeDataWireComponentsForState");
    expect(appHtml).toContain("function runtimeDataWireDisplayValue");
    expect(appHtml).toContain("function runtimeDataWireUrlValue");
    expect(appHtml).toContain("runtimeDataWireComponentsForState(state, repeat)");
    expect(appHtml).not.toContain("runtimeComponentIsRawDataDump");
    expect(appHtml).not.toContain("runtimeTemplateTouchesPath");
    expect(appHtml).not.toContain("{{");
    expect(appHtml).toContain('prefix + ".0"');
    expect(appHtml).not.toContain("readableRepeatComponentsForRuntime(state.components, item, repeat.as, repeat.path)");
  });

  test("fetch runtime uses one fresh active run, not a response cache @smoke", () => {
    const html = stateHtml();
    const appHtml = generatedAppHtml();

    expect(html).toContain("let dataSourceRunSerial = 0");
    expect(html).toContain("let activeDataSourceRun = null");
    expect(html).toContain("await ensureStateDataSource(s)");
    expect(html).toContain("function resetEditorDataSourceContext");
    expect(html).toContain("sourceChanged = dataSourceSignature(previous) !== dataSourceSignature(next)");
    expect(html).toContain("resetEditorDataSourceContext(previous.target)");
    expect(html).toContain("data: null");
    expect(html).toContain("count: 0");
    expect(html).toContain("error: \"\"");
    expect(appHtml).toContain("function changedDataSourceTargets");
    expect(appHtml).toContain("function resetDataSourceContextTargets");
    expect(appHtml).toContain("if (changedTargets.length) resetDataSourceContextTargets(changedTargets)");
    expect(appHtml).toContain('screen.innerHTML = ""');
    expect(html).not.toContain("dataSourceRuns = new Map");
    expect(html).not.toContain("dataSourceRuns.");
  });

  test("data wires drive rendered content through global state @smoke", () => {
    const html = stateHtml();
    const appHtml = generatedAppHtml();

    expect(html).toContain("function normalizeDataWire(value)");
    expect(html).toContain("function dataWireFromPath");
    expect(html).toContain("function dataWireComponentsForState");
    expect(html).toContain("function applyDerivedDataWires");
    expect(html).toContain("dataWires: normalizeDataWires");
    expect(html).toContain("Render mapping");
    expect(html).toContain("Mappe State-Daten-Scope auf Image, Heading, Text");
    expect(html).toContain("components: [],");
    expect(html).toContain("function dataWireDisplayValue");
    expect(html).toContain("function dataWireUrlValue");
    expect(appHtml).toContain("function normalizeDataWire(value)");
    expect(appHtml).toContain("function runtimeDataWireComponentsForState");
    expect(appHtml).toContain("function runtimeDataWireDisplayValue");
    expect(appHtml).toContain("function runtimeDataWireUrlValue");
    expect(appHtml).toContain("runtimeDataWireComponentsForState(state, repeat)");
    expect(appHtml).not.toContain("readableRepeatComponentsForRuntime(state.components, item, repeat.as, repeat.path)");
  });

  test("data-wire render placeholders stay referential and ordered @smoke", () => {
    const html = stateHtml();
    const appHtml = generatedAppHtml();

    expect(html).toContain('"transitionButton", "dataWire"');
    expect(html).toContain('if (component.type === "dataWire") norm.wireId');
    expect(html).toContain('component.type !== "dataWire" || wireIds.has(component.wireId)');
    expect(html).toContain("const dataWireComponentId = wireId => `data-wire:${wireId}`");
    expect(html).toContain('if (component.type === "dataWire") clean.wireId');
    expect(html).toContain('type: "dataWire"');
    expect(html).toContain("wireId: wire.id");
    expect(html).toContain("function snapshotStateTemplates");
    expect(html).toContain("components: migrateBodyToComponents(item.body, item.components || [])");
    expect(html).toContain('if (component.type === "list") {');
    expect(html).toContain("clone.items = normalizeListItems(component.items, component.text).map");

    expect(appHtml).toContain('"transitionButton", "dataWire"');
    expect(appHtml).toContain('if (component.type === "dataWire") norm.wireId');
    expect(appHtml).toContain("function runtimeOrderedRenderComponentsForState");
    expect(appHtml).toContain("const wireById = new Map(wireComponents.map(component => [component.wireId, component]))");
    expect(appHtml).toContain('if (component.type === "dataWire")');
    expect(appHtml).toContain("ordered.push(wireComponent)");
    expect(appHtml).toContain("return [...unplacedWires, ...ordered]");
    expect(appHtml).toContain("wireId: wire.id");
  });

  test("generated runtime writes global state through the bus @smoke", () => {
    const appHtml = generatedAppHtml();

    expect(appHtml).toContain('function runtimeSet(path, value, opts = {})');
    expect(appHtml).toContain('runtimeSet("fetched", result?.done ? Boolean(result && result.ok) : null');
    expect(appHtml).toContain('detail?.source === "fetch" && detail?.type === "change"');
    expect(appHtml).toContain('runtimeSet("state.current", runtimeTarget || ""');
    expect(appHtml).toContain('runtimeSet(v.name, sanitizeValue(readContextPathRaw(v.name), v)');
    expect(appHtml).not.toContain("Object.assign(context");
    expect(appHtml).not.toContain('silent: true, source: "fetch"');
    expect(appHtml).not.toContain("context[repeat.as] =");
    expect(appHtml).not.toContain("delete context[repeat.as]");
    expect(appHtml).not.toContain("context[v.name] = sanitizeValue");
    expect(appHtml).not.toContain('setValueAtPath(context, "state.current"');
  });

  test("only canvas-focused Delete removes selected graph items, Backspace does not @smoke", () => {
    const html = stateHtml();

    expect(html).toContain("function eventTargetsCanvasForDelete");
    expect(html).toContain('evt.key === "Delete" && eventTargetsCanvasForDelete(evt) && deleteActiveSelection()');
    expect(html).toContain("if (isEditableTarget(evt.target)) return;");
    expect(html).not.toContain('evt.key === "Backspace" && deleteActiveSelection()');
    expect(html).not.toContain('if (evt.key === "Delete" && deleteActiveSelection())');
  });

  test("runtime active state highlight stays visually distinct @smoke", () => {
    const html = stateHtml();

    expect(html).toContain("@keyframes activeStateBreath");
    expect(html).toContain("@keyframes activeSelectedStateBreath");
    expect(html).not.toContain("@keyframes activeStateDot");
    expect(html).not.toContain(".node.active::after");
    expect(html).toContain("animation: activeStateBreath 2.35s ease-in-out infinite");
    expect(html).toContain("animation: activeSelectedStateBreath 2.35s ease-in-out infinite");
    expect(html).toContain("stateEnterPulse 1.34s cubic-bezier(.16, 1, .3, 1)");
    expect(html).toContain("var RUNTIME_STATE_ENTER_PULSE_MS = 1420");
    expect(html).not.toContain(".svg-port.runtime .svg-port-hit");
    expect(html).not.toContain("@keyframes activePortBreath");
    expect(html).not.toContain("portEnterPulse 1.34s cubic-bezier(.16, 1, .3, 1)");
    expect(html).not.toContain("portExitPulse .88s ease-out");
    expect(html).not.toContain('if (state.id === currentAppState) classes.push("runtime")');
  });

  test("runtime transition flow pulse is frame-time driven @smoke", () => {
    const html = stateHtml();
    const pulseBody = html.slice(
      html.indexOf("function pulseRuntimeTransition(edgeId)"),
      html.indexOf("function runtimeStatePulseDuration")
    );

    expect(html).toContain("var runtimeEdgePulseFrame = 0");
    expect(html).toContain("function tickRuntimeEdgePulses(now)");
    expect(html).toContain("function applyRuntimeEdgePulseStyle(el, pulse, now)");
    expect(html).toContain("requestAnimationFrame(tickRuntimeEdgePulses)");
    expect(html).toContain("const elapsed = Math.max(0, now - (pulse.started || now))");
    expect(html).not.toContain("@keyframes edgePulse");
    expect(html).not.toContain("@keyframes edgeArrowPulse");
    expect(html).not.toContain("animation: edgePulse");
    expect(html).not.toContain("animation: edgeArrowPulse");
    expect(pulseBody).not.toContain("setTimeout");
    expect(pulseBody).not.toContain("getBoundingClientRect");
    expect(pulseBody).not.toContain("animationDelay");
  });
});

test.describe("Core browser contracts", () => {
  test("runtime orders placed and unplaced data wires with transition buttons through events @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Runtime Render Order",
      initial: "start",
      states: [
        {
          id: "start",
          title: "Start",
          body: "",
          x: 120,
          y: 160,
          data: { catalog: { item: { badge: "Featured", title: "Ada Chair" } } },
          dataWires: [
            { id: "wire_badge", sourcePath: "catalog.item.badge", role: "field", componentType: "text", label: "Badge" },
            { id: "wire_title", sourcePath: "catalog.item.title", role: "title", componentType: "heading", label: "Title" }
          ],
          components: [
            { id: "manual_note", type: "note", text: "Manual note", url: "" },
            { id: "slot_title", type: "dataWire", wireId: "wire_title", text: "", url: "" },
            { id: "slot_next", type: "transitionButton", transitionId: "to_done", text: "", url: "" }
          ]
        },
        { id: "done", title: "Done", body: "", x: 420, y: 160, components: [] }
      ],
      transitions: [
        { id: "to_done", from: "start", to: "done", label: "Continue", condition: "", triggerType: "button", set: { visited: true } }
      ]
    });

    const app = appFrame(page);
    await expect.poll(async () => app.locator("#screen").evaluate(screen => {
      const stack = screen.querySelector(".component-stack");
      return [...(stack?.children || [])].map(child =>
        child.querySelector("button[data-transition-id]")?.dataset.transitionId || child.textContent.trim()
      );
    })).toEqual(["Badge: Featured", "Manual note", "Ada Chair", "to_done"]);
    await expect(app.locator("button[data-transition-id='to_done']")).toHaveCount(1);

    await app.getByRole("button", { name: "Continue" }).click();
    await expect(app.locator("#statePill")).toHaveText("done");
  });

  test("multiple outgoing button transitions keep distinct event targets @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Branch Smoke",
      initial: "start",
      states: [
        { id: "start", title: "Start", body: "", components: [], data: {}, x: 120, y: 160 },
        { id: "toast", title: "Show toast", body: "", components: [{ id: "c_toast", type: "toast", text: "Toast reached", variant: "info" }], data: {}, x: 420, y: 80 },
        { id: "sound", title: "Play sound", body: "", components: [{ id: "c_sound", type: "sound", label: "Default chime", sound: "chime", autoplay: true }], data: {}, x: 420, y: 260 }
      ],
      transitions: [
        { id: "t_next", from: "start", to: "toast", label: "Next", condition: "", set: {} },
        { id: "t_next2", from: "start", to: "sound", label: "Next2", condition: "", set: {} }
      ]
    });

    const app = appFrame(page);
    const next = app.getByRole("button", { name: /^Next$/ });
    const next2 = app.getByRole("button", { name: /^Next2$/ });
    await expect(next).toBeVisible();
    await expect(next2).toBeVisible();
    const buttonColors = await Promise.all([
      next.evaluate(el => getComputedStyle(el).backgroundColor),
      next2.evaluate(el => getComputedStyle(el).backgroundColor)
    ]);
    expect(buttonColors[0]).not.toBe(buttonColors[1]);

    await next2.click();

    await expect(app.locator("#statePill")).toHaveText("sound");
    await expect(app.locator("h1")).toHaveText("Play sound");
  });

  test("boundary exit states keep direct buttons and share edge colors @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Boundary Exit Buttons",
      initial: "exit_child",
      states: [
        { id: "parent", title: "Parent", body: "", components: [], data: {}, boundary: { entryId: "entry_child", exitId: "exit_child", entryDisabled: false, exitDisabled: false }, x: 120, y: 160 },
        { id: "outside", title: "Outside", body: "", components: [], data: {}, x: 420, y: 160 },
        { id: "entry_child", title: "Entry Child", body: "", components: [], data: {}, parentId: "parent", x: 120, y: 120 },
        { id: "exit_child", title: "Exit Child", body: "", components: [], data: {}, parentId: "parent", x: 420, y: 120 },
        { id: "direct_a", title: "Direct A", body: "", components: [], data: {}, parentId: "parent", x: 720, y: 48 },
        { id: "direct_b", title: "Direct B", body: "", components: [], data: {}, parentId: "parent", x: 720, y: 216 }
      ],
      transitions: [
        { id: "t_intro", from: "entry_child", to: "exit_child", label: "To Exit", condition: "", triggerType: "button", set: {} },
        { id: "t_direct_a", from: "exit_child", to: "direct_a", label: "Direct A", condition: "", triggerType: "button", set: {} },
        { id: "t_direct_b", from: "exit_child", to: "direct_b", label: "Direct B", condition: "", triggerType: "button", set: {} },
        { id: "t_parent_exit", from: "parent", to: "outside", label: "Parent Out", condition: "", triggerType: "button", groupExitId: "exit_child", set: {} }
      ]
    });

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("exit_child");
    await expect(app.getByRole("button", { name: "Direct A" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Direct B" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Parent Out" })).toBeVisible();
    await expect(app.locator("button[data-transition-id]")).toHaveCount(3);

    const buttonColors = await app.locator("button[data-transition-id]").evaluateAll(buttons => Object.fromEntries(
      buttons.map(button => [
        button.dataset.transitionId,
        getComputedStyle(button).getPropertyValue("--button-color").trim()
      ])
    ));

    const edgeColorFor = async id => {
      const edge = page.locator(`.edge[data-edge-id="${id}"]`);
      await expect(edge).toHaveCount(1);
      return edge.evaluate(el => getComputedStyle(el).getPropertyValue("--edge-color").trim());
    };
    await page.locator('[data-id="parent"]').dblclick();
    await expect(page.locator('[data-id="exit_child"]')).toBeVisible();

    const edgeColors = {
      t_direct_a: await edgeColorFor("t_direct_a"),
      t_direct_b: await edgeColorFor("t_direct_b"),
      t_parent_exit: await edgeColorFor("t_parent_exit")
    };

    expect(buttonColors.t_direct_a).toBe(edgeColors.t_direct_a);
    expect(buttonColors.t_direct_b).toBe(edgeColors.t_direct_b);
    expect(buttonColors.t_parent_exit).toBe(edgeColors.t_parent_exit);
  });

  test("boundary exit states include parent outs through output ports @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Nested Output Port Buttons",
      initial: "exit_child",
      states: [
        { id: "grand", title: "Grand", body: "", components: [], data: {}, boundary: { entryId: "parent", exitId: "parent", entryDisabled: false, exitDisabled: false }, x: 120, y: 160 },
        { id: "done", title: "Done", body: "", components: [], data: {}, x: 420, y: 160 },
        { id: "parent", title: "Parent", body: "", components: [], data: {}, parentId: "grand", boundary: { entryId: "entry_child", exitId: "exit_child", entryDisabled: false, exitDisabled: false }, x: 120, y: 160 },
        { id: "sibling_a", title: "Sibling A", body: "", components: [], data: {}, parentId: "grand", x: 420, y: 80 },
        { id: "sibling_b", title: "Sibling B", body: "", components: [], data: {}, parentId: "grand", x: 420, y: 240 },
        { id: "entry_child", title: "Entry Child", body: "", components: [], data: {}, parentId: "parent", x: 120, y: 120 },
        { id: "exit_child", title: "Exit Child", body: "", components: [], data: {}, parentId: "parent", x: 420, y: 120 }
      ],
      transitions: [
        { id: "entry_exit", from: "entry_child", to: "exit_child", label: "To Exit", condition: "", triggerType: "button", set: {} },
        { id: "parent_to_a", from: "parent", to: "sibling_a", label: "Sibling A", condition: "", triggerType: "button", groupExitId: "exit_child", set: {} },
        { id: "parent_to_b", from: "parent", to: "sibling_b", label: "Sibling B", condition: "", triggerType: "button", groupExitId: "exit_child", set: {} },
        { id: "boundary-flow:grand:output", from: "parent", to: "proxy:grand:output", label: "OUT", condition: "", triggerType: "button", boundaryFlow: { parentId: "grand", side: "output", stateId: "parent" }, set: {} },
        { id: "grand_done", from: "grand", to: "done", label: "Done", condition: "", triggerType: "button", groupExitId: "parent", set: {} }
      ]
    });

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("exit_child");
    await expect(app.locator("button[data-transition-id]")).toHaveCount(3);
    await expect(app.getByRole("button", { name: "Sibling A" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Sibling B" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Done" })).toBeVisible();

    const buttonColors = await app.locator("button[data-transition-id]").evaluateAll(buttons => Object.fromEntries(
      buttons.map(button => [
        button.dataset.transitionId,
        getComputedStyle(button).getPropertyValue("--button-color").trim()
      ])
    ));

    const edgeColorFor = async id => {
      const edge = page.locator(`.edge[data-edge-id="${id}"]`);
      await expect(edge).toHaveCount(1);
      return edge.evaluate(el => getComputedStyle(el).getPropertyValue("--edge-color").trim());
    };
    const rootDoneColor = await edgeColorFor("grand_done");

    await app.getByRole("button", { name: "Done" }).click();
    await expect(app.locator("#statePill")).toHaveText("done");

    await page.locator('[data-id="grand"]').dblclick();
    await expect(page.locator('[data-id="parent"]')).toBeVisible();
    const edgeColors = {
      parent_to_a: await edgeColorFor("parent_to_a"),
      parent_to_b: await edgeColorFor("parent_to_b"),
      grand_done: rootDoneColor
    };

    expect(buttonColors.parent_to_a).toBe(edgeColors.parent_to_a);
    expect(buttonColors.parent_to_b).toBe(edgeColors.parent_to_b);
    expect(buttonColors.grand_done).toBe(edgeColors.grand_done);
  });

  test("state editor exposes global-state path subscriptions without output editing @smoke", async ({ page }) => {
    await openTool(page);

    await openStateInspector(page, "login");
    await page.locator("#pDataCard summary").click();

    await expect(page.getByText("Global State JSON")).toBeVisible();
    await expect(page.locator("#pSubscriptionTree")).toBeVisible();
    await expect(page.locator("#pSubscriptionAdd")).toBeHidden();
    await expect(page.locator("#pOutputs")).toHaveCount(0);
  });

  test("state data card stays collapsible instead of always noisy @smoke", () => {
    const html = stateHtml();

    expect(html).toContain('<details class="inspector-collapse data-card" id="pDataCard">');
    expect(html).toContain('<summary class="inspector-collapse-summary">');
    expect(html).toContain('<div class="inspector-collapse-body">');
    expect(html).toContain(".inspector-collapse[open] .inspector-collapse-summary::after");
  });

  test("global-state json paths create data-wire render mappings @smoke", async ({ page }) => {
    await openTool(page);

    await openStateInspector(page, "auth_start");
    await page.locator("#pDataCard summary").click();

    const stateCurrent = page.locator('#pSubscriptionTree [data-path="state.current"]');
    await expect(stateCurrent).toBeVisible();
    await stateCurrent.locator(".global-state-json-toggle").click();

    await expect(page.locator("#pDataWireList .data-wire-row").filter({ hasText: "state.current" })).toBeVisible();
    await expect(page.locator("#pComponents .template-binding-picker")).toHaveCount(0);
  });

  test("global state json tree branches can collapse and expand @smoke", async ({ page }) => {
    await openTool(page);

    await openStateInspector(page, "auth_start");
    await page.locator("#pDataCard summary").click();

    const tree = page.locator("#pSubscriptionTree");
    const before = await tree.locator(".global-state-json-line").count();
    const toggle = tree.locator(".global-state-json-collapse").first();
    await expect(toggle).toBeVisible();

    await toggle.click();
    await expect.poll(async () => tree.locator(".global-state-json-line").count()).toBeLessThan(before);
    const collapsed = await tree.locator(".global-state-json-line").count();

    await tree.locator(".global-state-json-collapse").first().click();
    await expect.poll(async () => tree.locator(".global-state-json-line").count()).toBeGreaterThan(collapsed);
  });

  test("repeat over is selected from derived candidates, not typed as free text @smoke", async ({ page }) => {
    await openTool(page);

    await openStateInspector(page, "auth_start");
    await page.locator("#pDataCard summary").click();

    const repeat = page.locator("#pRepeatPath");
    await expect(repeat).toHaveJSProperty("tagName", "SELECT");
    await expect(repeat.locator("option", { hasText: /No repeat|No repeated list/ })).toHaveCount(1);
    await expect(page.locator("#pRepeatPathList")).toHaveCount(0);
  });

  test("repeat over keeps a saved selection when the inspector opens @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Repeat Selection Smoke",
      initial: "start",
      states: [
        {
          id: "start",
          title: "Start",
          body: "",
          x: 120,
          y: 160,
          data: { items: [{ title: "One" }] },
          repeat: { path: "items", as: "item", index: "i" },
          components: [{ id: "c_item", type: "text", text: "{{item.title}}" }]
        }
      ],
      transitions: []
    });

    await page.locator('[data-id="start"]').click();

    await expect(page.locator("#pRepeatPath")).toHaveValue("items");
    await expect(page.locator("#pRepeatPreview")).toContainText("items");
  });
});
