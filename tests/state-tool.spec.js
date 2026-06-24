const fs = require("node:fs");
const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "stateBlueprintHotLinked.model.v2";
const GRID_SIZE = 24;

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
async function openTool(page) {
  await page.addInitScript(({ key, model }) => {
    for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
      localStorage.removeItem(name);
    }
    localStorage.setItem(key, JSON.stringify(model));
  }, { key: STORAGE_KEY, model: defaultTestModel() });
  await page.goto("/state.html");
  await expect(page.locator('[data-id="auth_start"]')).toBeVisible();
  await expect(page.locator(".node")).toHaveCount(8);
  await expect(appFrame(page).locator("#statePill")).toHaveText("auth_start");
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

async function openStateLayer(page, id) {
  await page.locator('[data-id="' + id + '"]').dblclick();
  await expect(page.locator("#layerFrameLabel")).toContainText(/Inside|Root/);
}

async function centerOf(locator) {
  const box = await visibleBox(locator);
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

async function visibleBox(locator) {
  let box = null;
  await expect(locator).toBeVisible();
  await expect.poll(async () => {
    box = await locator.boundingBox();
    return Boolean(box && box.width && box.height);
  }).toBe(true);
  return box;
}

async function savedModel(page) {
  return page.evaluate(key => {
    const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
    if (stored) return stored.model || stored;
    if (typeof model !== "undefined") return JSON.parse(JSON.stringify(model));
    return null;
  }, STORAGE_KEY);
}

async function firstChildStateId(page, parentId) {
  const id = await page.evaluate(({ key, parentId }) => {
    const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
    const model = stored?.model || stored;
    return model.states.find(state => state.parentId === parentId)?.id || "";
  }, { key: STORAGE_KEY, parentId });
  expect(id).toBeTruthy();
  return id;
}

async function savedStateTemplates(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(`${key}.stateExplorer`) || "[]"), STORAGE_KEY);
}

async function savedUiState(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(`${key}.ui`) || "{}"), STORAGE_KEY);
}

function componentEditor(page, title) {
  return page.locator(".component-editor").filter({
    has: page.locator(".component-editor-head span").filter({ hasText: new RegExp(`^${title}$`) })
  });
}

function dataRenderRows(page) {
  return page.locator(".component-editor").filter({
    has: page.locator(".component-editor-title").filter({ hasText: /^Data: / })
  });
}

function componentPreset(page, title) {
  return page.locator(".component-preset-card").filter({
    has: page.locator(".template-title").filter({ hasText: new RegExp(`^${title}$`) })
  });
}

function nodeByTitle(page, title) {
  return page.locator(".node").filter({
    has: page.locator(".title").filter({ hasText: new RegExp(`^${title}$`) })
  });
}

async function addComponentState(page, title) {
  await componentPreset(page, title).getByRole("button", { name: `+ ${title}` }).click();
  await expect(page.locator("#pTitle")).toHaveValue(title);
}

async function worldTransform(page) {
  return page.locator("#world").evaluate(el => getComputedStyle(el).transform);
}

async function worldScale(page) {
  return page.locator("#world").evaluate(el => {
    const transform = getComputedStyle(el).transform;
    return new DOMMatrixReadOnly(transform === "none" ? undefined : transform).a;
  });
}

async function assertVisibleInViewport(page, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} is not visible`);
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

async function emptyCanvasPoint(page) {
  const point = await page.evaluate(() => {
    const map = document.querySelector("#map");
    const rect = map.getBoundingClientRect();
    for (let y = rect.top + 100; y < rect.top + rect.height - 120; y += 38) {
      for (let x = rect.left + 80; x < rect.left + rect.width - 80; x += 46) {
        const el = document.elementFromPoint(x, y);
        if (!el || !map.contains(el)) continue;
        if (el.closest(".state-explorer, .node, .edge, .hit, .edge-label, .edge-tip-hit, .help, .selection-actions")) continue;
        return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("Could not find an empty canvas point");
  return point;
}

async function addChildByDoubleClick(page, parentId, excludeIds = []) {
  const beforeIds = new Set(await page.locator(".node").evaluateAll(nodes => nodes.map(node => node.dataset.id).filter(Boolean)));
  excludeIds.forEach(id => beforeIds.add(id));
  await expect.poll(async () => page.evaluate(() => {
    try {
      return Date.now() >= suppressEmptyCanvasDblClickUntil;
    } catch (_) {
      return true;
    }
  })).toBe(true);
  const point = await emptyCanvasPoint(page);
  await page.mouse.dblclick(point.x, point.y);
  let createdId = "";
  await expect.poll(async () => {
    const ids = await page.locator(".node").evaluateAll(nodes => nodes.map(node => node.dataset.id).filter(Boolean));
    createdId = ids.find(id => !beforeIds.has(id)) || "";
    return createdId;
  }).not.toBe("");
  return createdId;
}

async function dragComponentEditorBefore(page, sourceTitle, targetTitle) {
  await expect(componentEditor(page, sourceTitle)).toBeVisible();
  await expect(componentEditor(page, targetTitle)).toBeVisible();
  const moved = await page.evaluate(({ sourceTitle, targetTitle }) => {
    const rowTitle = row => row.querySelector(".component-editor-title")?.textContent?.trim() ||
      row.querySelector(".component-editor-head span")?.textContent?.trim() ||
      "";
    const rows = [...document.querySelectorAll(".component-editor")];
    const source = rows.find(row => rowTitle(row) === sourceTitle);
    const target = rows.find(row => rowTitle(row) === targetTitle);
    const handle = source?.querySelector(".component-drag-handle");
    if (!source || !target || !handle) return false;
    const dataTransfer = new DataTransfer();
    const dispatchDrag = (element, type, clientY) => {
      const rect = element.getBoundingClientRect();
      const event = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX: rect.left + Math.min(12, Math.max(1, rect.width / 2)),
        clientY
      });
      return element.dispatchEvent(event);
    };
    const sourceRect = source.getBoundingClientRect();
    dispatchDrag(handle, "dragstart", sourceRect.top + 4);
    const targetRect = target.getBoundingClientRect();
    dispatchDrag(target, "dragover", targetRect.top + 2);
    dispatchDrag(target, "drop", targetRect.top + 2);
    dispatchDrag(handle, "dragend", sourceRect.top + 4);
    return true;
  }, { sourceTitle, targetTitle });
  expect(moved).toBe(true);
}

async function dispatchLostDesktopMouseRelease(page, point = { x: 18, y: 18 }) {
  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      buttons: 0
    }));
  }, point);
}

async function dragNodeToStateExplorer(page, node) {
  const nodeBox = await visibleBox(node);
  const explorerBox = await visibleBox(page.locator("#stateExplorer"));
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(explorerBox.x + explorerBox.width / 2, explorerBox.y + explorerBox.height / 2, { steps: 14 });
  await page.mouse.up();
}

async function dragTransition(page, output, input, via = null) {
  const start = await centerOf(output);
  const end = await centerOf(input);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  if (via) await page.mouse.move(via.x, via.y, { steps: 8 });
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

async function gridGeometryReport(page) {
  return page.evaluate(gridSize => {
    const numberList = value => (value.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    const pointsFromPath = value => {
      const numbers = numberList(value);
      const points = [];
      for (let i = 0; i < numbers.length; i += 2) points.push({ x: numbers[i], y: numbers[i + 1] });
      return points;
    };
    const onGrid = value => Math.abs(value / gridSize - Math.round(value / gridSize)) < 0.001;
    return {
      nodes: [...document.querySelectorAll(".node")].map(node => {
        const style = getComputedStyle(node);
        const left = Number.parseFloat(node.style.left);
        const top = Number.parseFloat(node.style.top);
        const width = Number.parseFloat(node.style.width);
        const height = Number.parseFloat(node.style.height || style.height);
        return {
          id: node.dataset.id,
          left,
          top,
          width,
          height,
          overflow: style.overflow,
          isolation: style.isolation,
          output: { x: left + width, y: top + height / 2 },
          input: { x: left, y: top + height / 2 }
        };
      }),
      paths: [...document.querySelectorAll(".edge[data-edge-id]")].map(edge => {
        const d = edge.getAttribute("d") || "";
        const points = pointsFromPath(d);
        const segments = points.slice(1).map((point, index) => {
          const previous = points[index];
          const vertical = point.x === previous.x && point.y !== previous.y;
          const horizontal = point.y === previous.y && point.x !== previous.x;
          if (!vertical && !horizontal) return null;
          return {
            id: edge.dataset.edgeId,
            orientation: vertical ? "vertical" : "horizontal",
            coordinate: vertical ? point.x : point.y,
            min: vertical ? Math.min(previous.y, point.y) : Math.min(previous.x, point.x),
            max: vertical ? Math.max(previous.y, point.y) : Math.max(previous.x, point.x),
            x: vertical ? point.x : null,
            y: horizontal ? point.y : null,
            y1: vertical ? Math.min(previous.y, point.y) : null,
            y2: vertical ? Math.max(previous.y, point.y) : null,
            x1: horizontal ? Math.min(previous.x, point.x) : null,
            x2: horizontal ? Math.max(previous.x, point.x) : null
          };
        }).filter(Boolean);
        return {
          id: edge.dataset.edgeId,
          d,
          points,
          stroke: getComputedStyle(edge).stroke,
          segments,
          verticalSegments: segments.filter(segment => segment.orientation === "vertical"),
          horizontalSegments: segments.filter(segment => segment.orientation === "horizontal"),
          usesOnlyGridLines: /^M -?\d+(?:\.\d+)? -?\d+(?:\.\d+)?(?: L -?\d+(?:\.\d+)? -?\d+(?:\.\d+)?)*$/.test(d),
          allPointsOnGrid: points.every(point => onGrid(point.x) && onGrid(point.y)),
          allSegmentsOrthogonal: points.slice(1).every((point, index) => {
            const previous = points[index];
            return point.x === previous.x || point.y === previous.y;
          })
        };
      }),
      pins: [...document.querySelectorAll(".edge-pin[data-edge-id]")].map(pin => ({
        id: pin.dataset.edgeId,
        side: pin.dataset.edgePin,
        x: Number.parseFloat(pin.getAttribute("cx")),
        y: Number.parseFloat(pin.getAttribute("cy")),
        fill: getComputedStyle(pin).fill,
        stroke: getComputedStyle(pin).stroke
      })),
      portSlots: [...document.querySelectorAll(".port-slot")].map(slot => {
        const node = slot.closest(".node");
        const nodeStyle = getComputedStyle(node);
        const left = Number.parseFloat(node.style.left);
        const top = Number.parseFloat(node.style.top);
        const width = Number.parseFloat(node.style.width);
        const localY = Number.parseFloat(slot.style.top);
        const side = slot.dataset.portSlot;
        return {
          id: slot.dataset.edgeId,
          nodeId: node.dataset.id,
          side,
          x: side === "out" ? left + width : left,
          y: top + localY,
          fill: getComputedStyle(slot).backgroundColor,
          zIndex: Number.parseInt(getComputedStyle(slot).zIndex, 10) || 0,
          width: Number.parseFloat(node.style.width || nodeStyle.width)
        };
      }),
      arrows: [...document.querySelectorAll(".edge-arrow[data-edge-id]")].map(arrow => ({
        id: arrow.dataset.edgeId,
        fill: getComputedStyle(arrow).fill,
        stroke: getComputedStyle(arrow).stroke,
        d: arrow.getAttribute("d") || "",
        points: pointsFromPath(arrow.getAttribute("d") || "")
      }))
    };
  }, GRID_SIZE);
}

function segmentIntersectsNode(segment, node, margin = 0) {
  const x1 = node.left - margin;
  const x2 = node.left + node.width + margin;
  const y1 = node.top - margin;
  const y2 = node.top + node.height + margin;
  if (segment.orientation === "horizontal") {
    return segment.coordinate > y1 &&
      segment.coordinate < y2 &&
      Math.max(segment.min, x1) < Math.min(segment.max, x2);
  }
  return segment.coordinate > x1 &&
    segment.coordinate < x2 &&
    Math.max(segment.min, y1) < Math.min(segment.max, y2);
}

test.describe("State Blueprint tool", () => {
  test("creates a complete state machine from the UI with data, templates, conditions, sets, preview, and export", async ({ page }) => {
    await openTool(page);
    await page.getByRole("button", { name: "New" }).click();
    await page.getByRole("button", { name: "Neu starten" }).click();

    await expect(page.locator(".node")).toHaveCount(1);
    await expect(page.locator('[data-id="start"]')).toBeVisible();

    await page.locator('[data-id="start"]').click();
    await page.locator("#pTitle").fill("Collect details");
    await page.locator("#pData").fill('{"userName":"Ada","profile":{"tier":"starter"}}');
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "start").data.profile?.tier;
    }).toBe("starter");

    await page.locator("#pEnterLayer").click();
    await addComponentState(page, "Heading");
    await componentEditor(page, "Heading").locator("input").fill("Welcome {{userName}}");
    await addComponentState(page, "Text");
    await componentEditor(page, "Text").locator("textarea").fill("Tier: {{profile.tier}}");
    await addComponentState(page, "List");
    const listInputs = componentEditor(page, "List").locator(".list-item-editor input");
    await listInputs.nth(0).fill("Confirm email");
    await listInputs.nth(1).fill("Accept terms");
    await addComponentState(page, "Link");
    await componentEditor(page, "Link").locator("input").nth(0).fill("Example docs for {{userName}}");
    await componentEditor(page, "Link").locator("input").nth(1).fill("https://example.com/docs");
    await expect.poll(async () => {
      const model = await savedModel(page);
      const linkState = model.states.find(state => state.parentId === "start" && state.title === "Link");
      return linkState?.components.find(component => component.type === "link")?.url;
    }).toBe("https://example.com/docs");
    await addComponentState(page, "Note");
    await componentEditor(page, "Note").locator("textarea").fill("Stored from state.data: {{userName}}");
    await page.keyboard.press("Alt+ArrowLeft");

    const startPort = await centerOf(page.locator('[data-id="start"] .port'));
    const map = await page.locator("#map").boundingBox();
    await page.mouse.move(startPort.x, startPort.y);
    await page.mouse.down();
    await page.mouse.move(map.x + 430, map.y + 230, { steps: 12 });
    await page.mouse.up();

    await expect(page.locator(".node")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await page.locator("svg text.edge-label").filter({ hasText: /^To State/ }).click();
    await page.locator("#pLabel").fill("Submit");
    await page.locator("#pCond").fill('email == "ada@example.com" && accepted_terms');
    await page.locator("#pSet").fill('{"userName":"Grace","role":"member"}');

    const createdStateId = await page.evaluate(key => {
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const model = stored?.model || stored;
      return model.states.find(state => !state.parentId && state.id !== "start").id;
    }, STORAGE_KEY);

    await page.locator(`[data-id="${createdStateId}"]`).click();
    await page.locator("#pTitle").fill("Lesson ready");
    await page.locator("#pEnterLayer").click();
    await addComponentState(page, "Note");
    await componentEditor(page, "Note").locator("textarea").fill("Ready for {{userName}} as {{role}}");
    await page.keyboard.press("Alt+ArrowLeft");

    const app = appFrame(page);
    await page.locator(`[data-id="${createdStateId}"]`).click();
    await expect(app.locator("#statePill")).toHaveText(createdStateId);
    await page.locator('[data-id="start"]').click();
    await expect(app.locator("#statePill")).toHaveText("start");
    await expect(app.getByText("Welcome Ada")).toBeVisible();
    await expect(app.getByText("Tier: starter")).toBeVisible();
    await expect(app.getByText("Stored from state.data: Ada")).toBeVisible();
    await expect(app.getByRole("link", { name: "Example docs for Ada" })).toHaveAttribute("href", "https://example.com/docs");

    await app.getByRole("button", { name: "Submit" }).click();
    await expect(app.locator("#statePill")).toHaveText("start");
    await expect(app.locator(".action.invalid").filter({ hasText: "Submit" }).locator(".condition-feedback"))
      .toContainText("Condition not met");

    await app.locator(".field").filter({ hasText: "email" }).locator("input").fill("ada@example.com");
    await app.locator(".field").filter({ hasText: "accepted_terms" }).locator(".switch").click();
    await app.getByRole("button", { name: "Submit" }).click();

    await expect(app.locator("#statePill")).toHaveText(createdStateId);
    await expect(app.getByText("Ready for Grace as member")).toBeVisible();

    const model = await savedModel(page);
    const start = model.states.find(state => state.id === "start");
    const done = model.states.find(state => state.id === createdStateId);
    const transition = model.transitions.find(item => item.from === "start" && item.to === createdStateId);
    expect(start.data.userName).toBe("Ada");
    expect(start.data.profile.tier).toBe("starter");
    expect(model.states.filter(state => state.parentId === "start").map(state => state.components[0]?.type)).toEqual(["heading", "text", "list", "link", "note"]);
    expect(model.states.find(state => state.parentId === done.id && state.title === "Note").components[0].text).toBe("Ready for {{userName}} as {{role}}");
    expect(transition.label).toBe("Submit");
    expect(transition.condition).toBe('email == "ada@example.com" && accepted_terms');
    expect(transition.set).toEqual({ userName: "Grace", role: "member" });

    const saveDownload = page.waitForEvent("download");
    await page.keyboard.press("Control+S");
    const definitionDownload = await saveDownload;
    const definition = JSON.parse(fs.readFileSync(await definitionDownload.path(), "utf8"));
    expect(definition.model.states.find(state => state.id === "start").data.userName).toBe("Ada");
    expect(definition.model.transitions.find(item => item.label === "Submit").set.role).toBe("member");
  });

  test("renders state data defaults and transition set data in templates", async ({ page }) => {
    const model = {
      version: 2,
      name: "Data Flow",
      initial: "login",
      states: [
        {
          id: "login",
          title: "Login",
          body: "",
          x: 120,
          y: 140,
          data: { userName: "Ada" },
          components: [{ id: "c_welcome", type: "text", text: "Welcome {{userName}}", url: "" }]
        },
        {
          id: "logged_in",
          title: "Logged in",
          body: "",
          x: 430,
          y: 140,
          data: {},
          components: [{ id: "c_done", type: "note", text: "Signed in as {{userName}} with role {{role}}", url: "" }]
        }
      ],
      transitions: [
        {
          id: "t_login",
          from: "login",
          to: "logged_in",
          label: "Einloggen",
          condition: "email == \"user@example.com\" && password == \"secret123\"",
          set: { userName: "Grace", role: "admin" }
        }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(page.locator('[data-id="login"]')).toBeVisible();
    await expect(app.locator("#statePill")).toHaveText("login");
    await expect(app.getByText("Welcome Ada")).toBeVisible();

    await app.locator(".field").filter({ hasText: "email" }).locator("input").fill("user@example.com");
    await app.locator(".field").filter({ hasText: "password" }).locator("input").fill("secret123");
    await app.getByRole("button", { name: "Einloggen" }).click();

    await expect(app.locator("#statePill")).toHaveText("logged_in");
    await expect(app.getByText("Signed in as Grace with role admin")).toBeVisible();

    const saveDownload = page.waitForEvent("download");
    await page.keyboard.press("Control+S");
    const definitionDownload = await saveDownload;
    const definition = JSON.parse(fs.readFileSync(await definitionDownload.path(), "utf8"));
    expect(definition.model.states.find(state => state.id === "login").data.userName).toBe("Ada");
    expect(definition.model.transitions.find(transition => transition.id === "t_login").set.role).toBe("admin");
  });

  test("migrates legacy state and preset body fields into text components", async ({ page }) => {
    const legacyModel = {
      version: 2,
      name: "Legacy body flow",
      initial: "legacy",
      states: [
        { id: "legacy", title: "Legacy", body: "Legacy screen body", components: [], data: {}, x: 120, y: 140 }
      ],
      transitions: []
    };
    const legacyTemplates = [
      { id: "tpl_legacy", title: "Legacy preset", body: "Legacy preset body", components: [], data: {} }
    ];

    await page.addInitScript(({ key, model, templates }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.setItem(`${key}.stateExplorer`, JSON.stringify(templates));
    }, { key: STORAGE_KEY, model: legacyModel, templates: legacyTemplates });

    await page.goto("/state.html");
    await page.locator('[data-id="legacy"]').click();
    await expect(componentEditor(page, "Text").locator("textarea")).toHaveValue("Legacy screen body");
    await expect.poll(async () => {
      const model = await savedModel(page);
      const state = model.states.find(item => item.id === "legacy");
      return {
        body: state.body,
        text: state.components.find(component => component.type === "text")?.text
      };
    }).toEqual({ body: "", text: "Legacy screen body" });

    const preset = page.locator(".state-template-card").filter({ hasText: "Legacy preset" });
    await expect(preset).toContainText("Legacy preset body");
    await preset.click();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Preset: Legacy preset");
    await expect(componentEditor(page, "Text").locator("textarea")).toHaveValue("Legacy preset body");
    await expect.poll(async () => {
      const templates = await savedStateTemplates(page);
      return {
        body: templates[0].body,
        text: templates[0].components.find(component => component.type === "text")?.text
      };
    }).toEqual({ body: "", text: "Legacy preset body" });
  });

  test("navigates into nested state canvases and keeps child states inside their parent @smoke", async ({ page }) => {
    await openTool(page);
    await expect(page.locator("#layerFrame")).toBeVisible();
    await expect(page.locator("#layerFrameLabel")).toHaveText("Root");

    await openStateLayer(page, "login");
    const childId = await addChildByDoubleClick(page, "login");
    await openStateInspector(page, childId);

    await expect(page.locator("#layerNav")).toBeHidden();
    await expect(page.locator("#layerFrame")).toBeVisible();
    await expect(page.locator("#layerFrameLabel")).toHaveText("Inside Login");
    await expect(page.locator("#layerBack")).toBeVisible();
    await expect(page.locator(".node")).toHaveCount(3);

    await expect(page.locator("#pTitle")).toBeVisible();
    await page.locator("#pTitle").fill("Email step");
    await expect(page.locator(`[data-id="${childId}"] .title`)).toHaveText("Email step");

    await expect.poll(async () => {
      const model = await savedModel(page);
      const child = model.states.find(state => state.id === childId);
      return {
        childParent: child?.parentId,
        rootCount: model.states.filter(state => !state.parentId).length,
        childCount: model.states.filter(state => state.parentId === "login").length
      };
    }).toEqual({ childParent: "login", rootCount: 6, childCount: 1 });
    const childFlow = await gridGeometryReport(page);
    const childNode = childFlow.nodes.find(node => node.id === childId);
    expect(childNode.overflow).toBe("visible");
    expect(childNode.isolation).toBe("isolate");

    await page.locator("#layerBack").click();
    await expect(page.locator("#layerFrame")).toBeVisible();
    await expect(page.locator("#layerFrameLabel")).toHaveText("Root");
    await expect(page.locator('[data-id="login"] .layer-badge')).toHaveText("1 state");
    await expect(page.locator(`[data-id="${childId}"]`)).toHaveCount(0);
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(6);

    await openStateLayer(page, "login");
    await expect(page.locator("#layerFrameLabel")).toHaveText("Inside Login");
    await expect(page.locator(`[data-id="${childId}"] .title`)).toHaveText("Email step");
    await expect(page.locator(".node")).toHaveCount(3);
  });

  test("opens nested state canvases with a node double click @smoke", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').dblclick();
    await expect(page.locator("#layerFrameLabel")).toHaveText("Inside Login");
    await expect(page.locator("#layerBack")).toBeVisible();
  });

  test("keeps root boundary proxies enabled unless the root boundary is explicitly disabled @smoke", async ({ page }) => {
    const rootFlowModel = boundary => ({
      version: 2,
      name: "Root Boundary Contract",
      initial: "left",
      ...(boundary ? { boundary } : {}),
      states: [
        { id: "left", title: "Left", body: "", components: [], x: 96, y: 192 },
        { id: "right", title: "Right", body: "", components: [], x: 504, y: 192 }
      ],
      transitions: [
        { id: "left_to_right", from: "left", to: "right", label: "Next", condition: "", set: {} }
      ]
    });

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model: rootFlowModel(null) });
    await page.goto("/state.html");

    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(2);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    await expect(page.locator('.node.boundary-input[data-id="proxy:__root__:input:__boundary_input"]')).toHaveCount(1);
    await expect(page.locator('.node.boundary-output[data-id="proxy:__root__:output:__boundary_output"]')).toHaveCount(1);
    await expect(page.locator('.edge[data-edge-id="left_to_right"]')).toHaveCount(1);
    await expect(page.locator('.edge[data-edge-id="boundary-flow:__root__:input"]')).toHaveCount(1);
    await expect(page.locator('.edge[data-edge-id="boundary-flow:__root__:output"]')).toHaveCount(1);
    await expect(page.locator('svg#ports .svg-port[data-state-id="proxy:__root__:input:__boundary_input"][data-port-side="out"]')).toHaveCount(1);
    await expect(page.locator('svg#ports .svg-port[data-state-id="proxy:__root__:output:__boundary_output"][data-port-side="in"]')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => ({
      entryId: model.boundary?.entryId || "",
      exitId: model.boundary?.exitId || "",
      inputFlow: model.transitions.some(transition => transition.id === "boundary-flow:__root__:input" && transition.from === "proxy:__root__:input:__boundary_input"),
      outputFlow: model.transitions.some(transition => transition.id === "boundary-flow:__root__:output" && transition.to === "proxy:__root__:output:__boundary_output")
    }))).toEqual({ entryId: "left", exitId: "right", inputFlow: true, outputFlow: true });

    await page.evaluate(model => loadEditorModel(model, false), rootFlowModel({
      entryId: "",
      exitId: "",
      entryDisabled: true,
      exitDisabled: true
    }));
    await expect(page.locator(".node")).toHaveCount(2);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(0);
    await expect(page.locator('.edge[data-edge-id="left_to_right"]')).toHaveCount(1);
    await expect(page.locator('[data-edge-id^="boundary-flow:"]')).toHaveCount(0);
  });

  test("deletes selected substates with the same Delete key path as root states", async ({ page }) => {
    await openTool(page);

    await openStateLayer(page, "login");
    const childId = await addChildByDoubleClick(page, "login");
    await openStateInspector(page, childId);
    await expect(page.locator("#layerFrameLabel")).toHaveText("Inside Login");
    await expect(page.locator(".node")).toHaveCount(3);
    await page.locator("#pTitle").fill("Temporary child");
    await page.locator(`[data-id="${childId}"]`).click();
    await expect(page.locator(`[data-id="${childId}"]`)).toHaveClass(/selected/);
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(false);
    await expect.poll(() => page.locator("#map").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Delete");
    await expect(page.locator(`[data-id="${childId}"]`)).toHaveCount(0);
    await expect(page.locator(".node")).toHaveCount(0);
    await expect(page.locator("#stateInspectorBody")).toContainText("No state selected");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return {
        hasChild: model.states.some(state => state.id === childId),
        linkedToChild: model.transitions.some(transition => transition.from === childId || transition.to === childId),
        currentLayer: model.states.filter(state => state.parentId === "login").length
      };
    }).toEqual({ hasChild: false, linkedToChild: false, currentLayer: 0 });
  });

  test("projects parent wiring through child states in the opened state canvas @smoke", async ({ page }) => {
    await openTool(page);

    const wiringModel = await savedModel(page);
    const wiring = {
      inputIds: wiringModel.transitions.filter(transition => transition.to === "login").map(transition => transition.id),
      outputIds: wiringModel.transitions.filter(transition => transition.from === "login").map(transition => transition.id)
    };
    expect(wiring.inputIds).toHaveLength(2);
    expect(wiring.outputIds).toHaveLength(2);

    await openStateLayer(page, "login");
    const childId = await addChildByDoubleClick(page, "login");

    await expect(page.locator(".node")).toHaveCount(3);
    await expect(page.locator(".edge[data-edge-id]")).toHaveCount(4);
    for (const id of [...wiring.inputIds, ...wiring.outputIds]) {
      await expect(page.locator(`.edge[data-edge-id="${id}"]`)).toHaveCount(1);
    }
    const directFlow = await gridGeometryReport(page);
    expect(directFlow.paths).toHaveLength(4);
    expect(directFlow.paths.every(path => path.points.length >= 2)).toBe(true);
    const projectionPorts = await page.evaluate(({ inputIds, outputIds }) => {
      const nums = value => (value.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      const pathPoints = value => {
        const values = nums(value);
        const points = [];
        for (let i = 0; i < values.length; i += 2) points.push({ x: values[i], y: values[i + 1] });
        return points;
      };
      const portPoint = selector => {
        const transform = document.querySelector(selector)?.getAttribute("transform") || "";
        const values = nums(transform);
        return { x: values[0], y: values[1] };
      };
      const inputProxyId = document.querySelector('.node.boundary-input')?.dataset.id || "";
      const outputProxyId = document.querySelector('.node.boundary-output')?.dataset.id || "";
      const inputPort = portPoint(`svg#ports .svg-port[data-state-id="${CSS.escape(inputProxyId)}"][data-port-side="out"]`);
      const outputPort = portPoint(`svg#ports .svg-port[data-state-id="${CSS.escape(outputProxyId)}"][data-port-side="in"]`);
      const edgePoints = id => pathPoints(document.querySelector(`.edge[data-edge-id="${CSS.escape(id)}"]`)?.getAttribute("d") || "");
      return {
        inputProxyId,
        outputProxyId,
        inputPort,
        outputPort,
        inputStarts: inputIds.map(id => edgePoints(id)[0]),
        outputEnds: outputIds.map(id => {
          const points = edgePoints(id);
          return points[points.length - 1];
        }),
        inputStrokes: inputIds.map(id => getComputedStyle(document.querySelector(`.edge[data-edge-id="${CSS.escape(id)}"]`)).stroke),
        outputStrokes: outputIds.map(id => getComputedStyle(document.querySelector(`.edge[data-edge-id="${CSS.escape(id)}"]`)).stroke)
      };
    }, wiring);
    expect(projectionPorts.inputProxyId).toBeTruthy();
    expect(projectionPorts.outputProxyId).toBeTruthy();
    for (const point of projectionPorts.inputStarts) expect(point.x).toBe(projectionPorts.inputPort.x);
    for (const point of projectionPorts.outputEnds) expect(point.x).toBe(projectionPorts.outputPort.x);
    expect(new Set(projectionPorts.inputStarts.map(point => point.y)).size).toBe(projectionPorts.inputStarts.length);
    expect(new Set(projectionPorts.outputEnds.map(point => point.y)).size).toBe(projectionPorts.outputEnds.length);
    expect(new Set(projectionPorts.inputStrokes).size).toBe(projectionPorts.inputStrokes.length);
    expect(new Set(projectionPorts.outputStrokes).size).toBe(projectionPorts.outputStrokes.length);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${childId}"][data-port-side="in"]`)).toHaveCount(1);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${childId}"][data-port-side="out"]`)).toHaveCount(1);

    await page.locator("#layerBack").click();
    await expect(page.locator("#layerFrame")).toBeVisible();
    await expect(page.locator("#layerFrameLabel")).toHaveText("Root");
    await expect(page.locator("#layerHud")).toBeVisible();
  });

  test("keeps unprojected boundary proxy edges when only one parent side has wiring @smoke", async ({ page }) => {
    await openTool(page);
    await page.evaluate(() => {
      model.transitions = model.transitions.filter(transition => transition.to !== "login");
      saveModel("test:asymmetric-boundary-proxy");
      draw();
    });

    await openStateLayer(page, "login");
    const childId = await addChildByDoubleClick(page, "login");
    const boundaryInputId = "boundary-flow:login:input";
    const boundaryOutputId = "boundary-flow:login:output";

    await expect.poll(async () => {
      const model = await savedModel(page);
      const parent = model.states.find(state => state.id === "login");
      return {
        entryId: parent?.boundary?.entryId || "",
        exitId: parent?.boundary?.exitId || "",
        inputFlow: model.transitions.some(transition => transition.id === boundaryInputId && transition.to === childId),
        outputFlow: model.transitions.some(transition => transition.id === boundaryOutputId && transition.from === childId)
      };
    }).toEqual({ entryId: childId, exitId: childId, inputFlow: true, outputFlow: true });

    await expect(page.locator(`.edge[data-edge-id="${boundaryInputId}"]`)).toHaveCount(1);
    await expect(page.locator(`.edge[data-edge-id="t_login_success"]`)).toHaveCount(1);
    await expect(page.locator(`.edge[data-edge-id="t_login_error"]`)).toHaveCount(1);

    const boundaryRoute = await page.evaluate(({ boundaryInputId, childId }) => {
      const nums = value => (value.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      const points = value => {
        const values = nums(value);
        const out = [];
        for (let i = 0; i < values.length; i += 2) out.push({ x: values[i], y: values[i + 1] });
        return out;
      };
      const portPoint = selector => {
        const values = nums(document.querySelector(selector)?.getAttribute("transform") || "");
        return { x: values[0], y: values[1] };
      };
      const inputProxyId = document.querySelector(".node.boundary-input")?.dataset.id || "";
      const route = points(document.querySelector(`.edge[data-edge-id="${CSS.escape(boundaryInputId)}"]`)?.getAttribute("d") || "");
      return {
        inputProxyId,
        start: route[0],
        end: route[route.length - 1],
        proxyOut: portPoint(`svg#ports .svg-port[data-state-id="${CSS.escape(inputProxyId)}"][data-port-side="out"]`),
        childIn: portPoint(`svg#ports .svg-port[data-state-id="${CSS.escape(childId)}"][data-port-side="in"]`)
      };
    }, { boundaryInputId, childId });
    expect(boundaryRoute.inputProxyId).toBeTruthy();
    expect(boundaryRoute.start).toMatchObject(boundaryRoute.proxyOut);
    expect(boundaryRoute.end.x).toBe(boundaryRoute.childIn.x);
    expect(Math.abs(boundaryRoute.end.y - boundaryRoute.childIn.y)).toBeLessThanOrEqual(GRID_SIZE);
  });

  test("selects output proxy references without creating new transitions @smoke", async ({ page }) => {
    await openTool(page);
    await openStateLayer(page, "login");
    await addChildByDoubleClick(page, "login");
    await expect(page.locator(`.edge[data-edge-id="t_login_success"]`)).toHaveCount(1);

    const before = await savedModel(page);
    const outputProxyId = await page.locator(".node.boundary-output").getAttribute("data-id");
    expect(outputProxyId).toBeTruthy();
    const port = page.locator(`svg#ports .svg-port[data-state-id="${outputProxyId}"][data-port-side="in"]`);
    const point = await centerOf(port);
    await page.mouse.click(point.x, point.y);

    await expect.poll(async () => page.evaluate(() => ({
      selectedEdge: selected?.edges?.[0] || "",
      stateCount: model.states.length,
      transitionCount: model.transitions.length
    }))).toEqual({
      selectedEdge: "t_login_success",
      stateCount: before.states.length,
      transitionCount: before.transitions.length
    });
  });

  test("rewires projected parent entry by dragging it to another child state @smoke", async ({ page }) => {
    await openTool(page);

    const inputModel = await savedModel(page);
    const inputId = inputModel.transitions.find(transition => transition.from === "auth_start" && transition.to === "login")?.id || "";
    expect(inputId).toBeTruthy();

    await openStateLayer(page, "login");
    const firstChildId = await addChildByDoubleClick(page, "login");
    const secondChildId = await addChildByDoubleClick(page, "login", [firstChildId]);

    await expect(page.locator(".node")).toHaveCount(4);
    await expect(page.locator(`[data-id="${firstChildId}"]`)).toBeVisible();
    await expect(page.locator(`[data-id="${secondChildId}"]`)).toBeVisible();
    const edgeTip = await centerOf(page.locator(`.edge-tip-hit[data-edge-id="${inputId}"]`));
    const secondBox = await visibleBox(page.locator(`[data-id="${secondChildId}"]`));
    const target = { x: secondBox.x + 8, y: secondBox.y + secondBox.height / 2 };

    await page.mouse.move(edgeTip.x, edgeTip.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 12 });
    await page.mouse.up();

    await expect.poll(async () => {
      const model = await savedModel(page);
      const transition = model.transitions.find(item => item.id === inputId);
      return {
        groupEntryId: transition?.groupEntryId
      };
    }).toEqual({ groupEntryId: secondChildId });

    await expect(page.locator(`.edge[data-edge-id="${inputId}"]`)).toHaveCount(1);
  });

  test("preview runtime steps into child canvases and keeps the editor viewport on the active layer @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Nested Runtime Flow",
      initial: "start",
      states: [
        { id: "start", title: "Start", body: "", x: 96, y: 160 },
        { id: "lesson", title: "Lesson", body: "", x: 360, y: 160 },
        { id: "done", title: "Done", body: "", x: 660, y: 160 },
        { id: "step_one", parentId: "lesson", title: "Step One", body: "", x: 120, y: 120 },
        { id: "step_two", parentId: "lesson", title: "Step Two", body: "", x: 420, y: 120 }
      ],
      transitions: [
        { id: "start_lesson", from: "start", to: "lesson", label: "Enter", condition: "" },
        { id: "step_one_two", from: "step_one", to: "step_two", label: "Continue", condition: "" },
        { id: "lesson_done", from: "lesson", to: "done", label: "Finish", condition: "" }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("start");

    await app.getByRole("button", { name: "Enter" }).click();
    await expect(app.locator("#statePill")).toHaveText("lesson");
    await expect(page.locator('[data-id="lesson"]')).toHaveClass(/active/);

    await app.getByRole("button", { name: "Step One" }).click();
    await expect(app.locator("#statePill")).toHaveText("step_one");
    await expect(page.locator("#layerFrameLabel")).toHaveText("Inside Lesson");
    await expect(page.locator(".node")).toHaveCount(4);
    await expect(page.locator('[data-id="step_one"]')).toHaveClass(/active/);

    await app.getByRole("button", { name: "Continue" }).click();
    await expect(app.locator("#statePill")).toHaveText("step_two");
    await expect(page.locator("#layerFrameLabel")).toHaveText("Inside Lesson");
    await expect(page.locator('[data-id="step_two"]')).toHaveClass(/active/);

    await app.getByRole("button", { name: "Finish" }).click();
    await expect(app.locator("#statePill")).toHaveText("done");
    await expect(page.locator("#layerFrameLabel")).toHaveText("Root");
    await expect(page.locator('[data-id="step_two"]')).toHaveCount(0);
    await expect(page.locator('[data-id="done"]')).toHaveClass(/active/);
  });

  test("selecting a composite state follows its child layer on the first runtime update @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Selected Composite Runtime Flow",
      initial: "start",
      states: [
        { id: "start", title: "Start", body: "", x: 96, y: 160 },
        { id: "lesson", title: "Lesson", body: "", x: 360, y: 160 },
        { id: "done", title: "Done", body: "", x: 660, y: 160 },
        { id: "step_one", parentId: "lesson", title: "Step One", body: "", x: 120, y: 120 },
        { id: "step_two", parentId: "lesson", title: "Step Two", body: "", x: 420, y: 120 }
      ],
      transitions: [
        { id: "start_lesson", from: "start", to: "lesson", label: "Enter", condition: "" },
        { id: "step_one_two", from: "step_one", to: "step_two", label: "Continue", condition: "" },
        { id: "lesson_done", from: "lesson", to: "done", label: "Finish", condition: "" }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("start");

    await page.locator('[data-id="lesson"]').click();
    await expect(app.locator("#statePill")).toHaveText("lesson");
    await app.getByRole("button", { name: "Step One" }).click();
    await expect(app.locator("#statePill")).toHaveText("step_one");
    await expect(page.locator("#layerFrameLabel")).toHaveText("Inside Lesson");
    await expect(page.locator('[data-id="step_one"]')).toHaveClass(/active/);
    await expect(page.locator('[data-id="step_one"]')).toHaveClass(/runtime-enter/);
    const stepOneInputPort = page.locator('svg#ports .svg-port[data-state-id="step_one"][data-port-side="in"]');
    await expect(stepOneInputPort).toHaveCount(1);
    await expect(stepOneInputPort).not.toHaveClass(/runtime-enter/);

    await app.getByRole("button", { name: "Continue" }).click();
    await expect(app.locator("#statePill")).toHaveText("step_two");
    await expect(page.locator("#layerFrameLabel")).toHaveText("Inside Lesson");
    await expect(page.locator('[data-id="step_two"]')).toHaveClass(/active/);
    await expect(page.locator('[data-id="step_one"]')).toHaveClass(/runtime-exit/);
    await expect(page.locator('[data-id="step_two"]')).toHaveClass(/runtime-enter/);

    await app.getByRole("button", { name: "Finish" }).click();
    await expect(app.locator("#statePill")).toHaveText("done");
    await expect(page.locator("#layerFrameLabel")).toHaveText("Root");
    await expect(page.locator('[data-id="step_two"]')).toHaveCount(0);
    await expect(page.locator('[data-id="done"]')).toHaveClass(/active/);
    await expect(page.locator('[data-id="done"]')).toHaveClass(/runtime-enter/);
    const doneEdge = page.locator('.edge[data-edge-id="lesson_done"]');
    await expect(doneEdge).toHaveClass(/runtime-pulse/);
    await expect(doneEdge).toHaveCSS("animation-name", "none");
    const firstDashOffset = await doneEdge.evaluate(el => el.style.strokeDashoffset);
    await expect.poll(() => doneEdge.evaluate(el => el.style.strokeDashoffset)).not.toBe(firstDashOffset);
  });

  test("keeps transition wires scoped to the opened state canvas @smoke", async ({ page }) => {
    await openTool(page);
    const rootEdgeCount = await page.locator(".edge[data-edge-id]").count();

    await openStateLayer(page, "login");
    const firstChildId = await addChildByDoubleClick(page, "login");
    const secondChildId = await addChildByDoubleClick(page, "login", [firstChildId]);
    const firstPort = await centerOf(page.locator(`svg#ports .svg-port[data-state-id="${firstChildId}"][data-port-side="out"]`));
    const secondBox = await visibleBox(page.locator(`[data-id="${secondChildId}"]`));
    await page.mouse.move(firstPort.x, firstPort.y);
    await page.mouse.down();
    await page.mouse.move(secondBox.x + 8, secondBox.y + secondBox.height / 2, { steps: 12 });
    await page.mouse.up();

    await expect(page.locator("#layerFrameLabel")).toHaveText("Inside Login");
    await expect(page.locator(".node")).toHaveCount(4);
    await expect(page.locator(`[data-id="${firstChildId}"]`)).toBeVisible();
    await expect(page.locator(`[data-id="${secondChildId}"]`)).toBeVisible();
    const innerEdgeId = await page.evaluate(({ key, from, to }) => {
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const model = stored?.model || stored;
      return model.transitions.find(transition => transition.from === from && transition.to === to)?.id || "";
    }, { key: STORAGE_KEY, from: firstChildId, to: secondChildId });
    expect(innerEdgeId).toBeTruthy();

    await page.locator("#layerBack").click();
    await expect(page.locator("#layerFrame")).toBeVisible();
    await expect(page.locator("#layerFrameLabel")).toHaveText("Root");
    await expect(page.locator(".edge[data-edge-id]")).toHaveCount(rootEdgeCount);
    await expect(page.locator(`.edge[data-edge-id="${innerEdgeId}"]`)).toHaveCount(0);

    await openStateLayer(page, "login");
    await expect(page.locator("#layerFrameLabel")).toHaveText("Inside Login");
    await expect(page.locator(`.edge[data-edge-id="${innerEdgeId}"]`)).toHaveCount(1);
  });

  test("drops state explorer presets into a state's inner canvas", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "Text");
    await page.locator("#pTitle").fill("Inner lesson");
    await componentEditor(page, "Text").locator("textarea").fill("Nested preset text");
    const sourceId = await page.locator(".node.selected").getAttribute("data-id");
    await dragNodeToStateExplorer(page, page.locator(`[data-id="${sourceId}"]`));
    await page.locator(`[data-id="${sourceId}"]`).click();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Delete");

    const preset = page.locator(".state-template-card").filter({ hasText: "Inner lesson" });
    await expect(preset).toBeVisible();

    await page.locator('[data-id="login"]').click();
    await expect(page.locator("#pInnerDropZone")).toBeVisible();
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await preset.dispatchEvent("dragstart", { dataTransfer });
    await page.locator("#pInnerDropZone").dispatchEvent("drop", { dataTransfer });

    await expect(page.locator("#layerNav")).toBeHidden();
    await expect(page.locator("#layerFrameLabel")).toHaveText("Inside Login");
    await expect(page.locator(".node")).toHaveCount(1);
    await expect(page.locator(".node .title")).toHaveText("Inner lesson");
    await expect(componentEditor(page, "Text").locator("textarea")).toHaveValue("Nested preset text");

    await expect.poll(async () => {
      const model = await savedModel(page);
      const child = model.states.find(state => state.title === "Inner lesson");
      return {
        parentId: child?.parentId,
        text: child?.components.find(component => component.type === "text")?.text
      };
    }).toEqual({ parentId: "login", text: "Nested preset text" });

    await page.locator("#layerBack").click();
    await expect(page.locator('[data-id="login"] .layer-badge')).toHaveText("1 state");
    await expect(page.locator(".node")).toHaveCount(4);
  });

  test("preserves inner state canvases when a state is saved to and reused from the explorer", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
    await page.locator("#pEnterLayer").click();
    await addComponentState(page, "Text");
    await componentEditor(page, "Text").locator("textarea").fill("Reusable nested child");
    const originalChildId = await page.locator(".node.selected").getAttribute("data-id");
    await page.keyboard.press("Alt+ArrowLeft");

    await dragNodeToStateExplorer(page, page.locator('[data-id="login"]'));
    const preset = page.locator(".state-template-card").filter({ hasText: "Login" });
    await expect(preset).toBeVisible();
    await expect.poll(async () => {
      const templates = await savedStateTemplates(page);
      return {
        childCount: templates[0]?.states?.length,
        childText: templates[0]?.states?.find(state => state.id === originalChildId)?.components?.[0]?.text
      };
    }).toEqual({ childCount: 1, childText: "Reusable nested child" });

    await preset.getByRole("button", { name: "Use" }).click();
    const reusedId = await page.locator(".node.selected").getAttribute("data-id");
    await expect(page.locator(`[data-id="${reusedId}"] .layer-badge`)).toHaveText("1 state");
    await page.locator(`[data-id="${reusedId}"] .node-open`).click();
    await expect(page.locator(".node")).toHaveCount(1);
    await expect(nodeByTitle(page, "Text")).toBeVisible();
    await nodeByTitle(page, "Text").click();
    await expect(componentEditor(page, "Text").locator("textarea")).toHaveValue("Reusable nested child");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.parentId === reusedId)?.components?.[0]?.text;
    }).toBe("Reusable nested child");
  });

  test("keeps invalid data and transition set JSON out of the saved model", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').click();
    await expect(page.locator("#pData")).toBeVisible();
    await page.locator("#pData").click();
    await page.locator("#pData").fill('{"userName":"Ada"}');
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login").data.userName;
    }).toBe("Ada");
    await page.locator("#pData").fill('{"userName":');
    await expect(page.locator("#pDataPreview")).toContainText("Unexpected end of JSON input");

    let model = await savedModel(page);
    expect(model.states.find(state => state.id === "login").data).toEqual({ userName: "Ada" });

    await page.keyboard.press("Escape");
    await page.locator("svg text.edge-label").filter({ hasText: /^Einloggen/ }).click();
    await page.locator("#pSet").fill('{"role":"admin"}');
    await page.locator("#pSet").fill('{"role":');
    await expect(page.locator("#pSetPreview")).toContainText("Unexpected end of JSON input");

    model = await savedModel(page);
    expect(model.transitions.find(transition => transition.label === "Einloggen").set).toEqual({ role: "admin" });
  });

  test("persists newly added component text immediately and renders it in preview", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
    await page.locator("#pData").fill('{"userName":"Ada"}');
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login").data.userName;
    }).toBe("Ada");
    await page.locator("#pEnterLayer").click();
    await addComponentState(page, "Note");
    await componentEditor(page, "Note").locator("textarea").fill("Manual note for {{userName}}");

    await expect.poll(async () => {
      const model = await savedModel(page);
      const note = model.states.find(state => state.parentId === "login" && state.title === "Note");
      return note?.components.find(component => component.type === "note")?.text || "";
    }).toBe("Manual note for {{userName}}");

    await page.keyboard.press("Alt+ArrowLeft");
    await page.locator('[data-id="login"]').click();
    await expect(appFrame(page).getByText("Manual note for Ada")).toBeVisible();
  });

  test("syncs render editor changes to preview without reloading the state @smoke", async ({ page }) => {
    await openTool(page);
    await openStateInspector(page, "auth_start");

    await expect(appFrame(page).getByText("User chooses login or registration.")).toBeVisible();
    await componentEditor(page, "Text").locator("textarea").fill("Live render update");
    await expect(appFrame(page).getByText("Live render update")).toBeVisible();

    await componentEditor(page, "Text").getByRole("button", { name: "Delete" }).click();
    await expect(appFrame(page).getByText("Live render update")).toHaveCount(0);
    await expect(appFrame(page).getByRole("button", { name: "Login" })).toBeVisible();
  });

  test("persists every state component field across reopening and renders them in the app", async ({ page }) => {
    await openTool(page);
    const imageUrl = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iNjAiPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iNjAiIGZpbGw9IiMyNTYzZWIiLz48L3N2Zz4=";
    const soundUrl = "https://example.com/{{userName}}/notify.mp3";

    await page.locator('[data-id="login"]').click();
    await page.locator("#pData").fill('{"userName":"Ada"}');
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login").data.userName;
    }).toBe("Ada");

    await page.locator("#pEnterLayer").click();
    await addComponentState(page, "Heading");
    await componentEditor(page, "Heading").locator("input").fill("Account heading {{userName}}");

    await addComponentState(page, "Text");
    await componentEditor(page, "Text").locator("textarea").fill("Body paragraph for {{userName}}");

    await addComponentState(page, "Image");
    await componentEditor(page, "Image").locator("input").nth(0).fill("Chart for {{userName}}");
    await componentEditor(page, "Image").locator("input").nth(1).fill(imageUrl);

    await addComponentState(page, "List");
    const listEditor = componentEditor(page, "List");
    await listEditor.locator(".list-item-editor input").nth(0).fill("First step for {{userName}}");
    await listEditor.locator(".list-item-editor input").nth(1).fill("Second step");
    await listEditor.locator(".component-add-item").click();
    await expect(listEditor.locator(".list-item-editor input")).toHaveCount(3);
    await listEditor.locator(".list-item-editor input").nth(2).fill("Third persisted step");

    await addComponentState(page, "Link");
    await componentEditor(page, "Link").locator("input").nth(0).fill("Docs for {{userName}}");
    await componentEditor(page, "Link").locator("input").nth(1).fill("https://example.com/{{userName}}/docs");

    await addComponentState(page, "Play sound");
    await componentEditor(page, "Play sound").locator("input").nth(0).fill("Sound alert for {{userName}}");
    await componentEditor(page, "Play sound").locator("input").nth(1).fill(soundUrl);

    await addComponentState(page, "Note");
    await componentEditor(page, "Note").locator("textarea").fill("Note survives for {{userName}}");

    await addComponentState(page, "Divider");

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.filter(state => state.parentId === "login").map(state => ({
        title: state.title,
        type: state.components[0]?.type,
        text: state.components[0]?.text,
        url: state.components[0]?.url
      }));
    }).toEqual([
      { title: "Heading", type: "heading", text: "Account heading {{userName}}", url: "" },
      { title: "Text", type: "text", text: "Body paragraph for {{userName}}", url: "" },
      { title: "Image", type: "image", text: "Chart for {{userName}}", url: imageUrl },
      { title: "List", type: "list", text: "First step for {{userName}}\nSecond step\nThird persisted step", url: "" },
      { title: "Link", type: "link", text: "Docs for {{userName}}", url: "https://example.com/{{userName}}/docs" },
      { title: "Play sound", type: "sound", text: "Sound alert for {{userName}}", url: soundUrl },
      { title: "Note", type: "note", text: "Note survives for {{userName}}", url: "" },
      { title: "Divider", type: "divider", text: "", url: "" }
    ]);

    await page.keyboard.press("Alt+ArrowLeft");
    await page.locator('[data-id="login"]').click();
    await page.locator("#pEnterLayer").click();

    await nodeByTitle(page, "Heading").click();
    await expect(componentEditor(page, "Heading").locator("input")).toHaveValue("Account heading {{userName}}");
    await nodeByTitle(page, "Text").click();
    await expect(componentEditor(page, "Text").locator("textarea")).toHaveValue("Body paragraph for {{userName}}");
    await nodeByTitle(page, "Image").click();
    await expect(componentEditor(page, "Image").locator("input").nth(0)).toHaveValue("Chart for {{userName}}");
    await expect(componentEditor(page, "Image").locator("input").nth(1)).toHaveValue(imageUrl);
    await nodeByTitle(page, "List").click();
    await expect(componentEditor(page, "List").locator(".list-item-editor input")).toHaveCount(3);
    await expect(componentEditor(page, "List").locator(".list-item-editor input").nth(0)).toHaveValue("First step for {{userName}}");
    await expect(componentEditor(page, "List").locator(".list-item-editor input").nth(1)).toHaveValue("Second step");
    await expect(componentEditor(page, "List").locator(".list-item-editor input").nth(2)).toHaveValue("Third persisted step");
    await nodeByTitle(page, "Link").click();
    await expect(componentEditor(page, "Link").locator("input").nth(0)).toHaveValue("Docs for {{userName}}");
    await expect(componentEditor(page, "Link").locator("input").nth(1)).toHaveValue("https://example.com/{{userName}}/docs");
    await nodeByTitle(page, "Play sound").click();
    await expect(componentEditor(page, "Play sound").locator("input").nth(0)).toHaveValue("Sound alert for {{userName}}");
    await expect(componentEditor(page, "Play sound").locator("input").nth(1)).toHaveValue(soundUrl);
    await nodeByTitle(page, "Note").click();
    await expect(componentEditor(page, "Note").locator("textarea")).toHaveValue("Note survives for {{userName}}");
    await nodeByTitle(page, "Divider").click();
    await expect(componentEditor(page, "Divider")).toBeVisible();

    await page.keyboard.press("Alt+ArrowLeft");
    await page.locator('[data-id="login"]').click();

    const app = appFrame(page);
    await expect(app.getByRole("heading", { name: "Account heading Ada" })).toBeVisible();
    await expect(app.getByText("Body paragraph for Ada")).toBeVisible();
    await expect(app.locator(".component-image")).toHaveAttribute("alt", "Chart for Ada");
    await expect(app.locator(".component-image")).toHaveAttribute("src", imageUrl);
    await expect(app.getByText("First step for Ada")).toBeVisible();
    await expect(app.getByText("Second step")).toBeVisible();
    await expect(app.getByText("Third persisted step")).toBeVisible();
    await expect(app.getByRole("link", { name: "Docs for Ada" })).toHaveAttribute("href", "https://example.com/Ada/docs");
    await expect(app.locator(".component-sound-label")).toHaveText("Sound alert for Ada");
    await expect(app.locator("audio.component-sound-player")).toHaveAttribute("src", "https://example.com/Ada/notify.mp3");
    await expect(app.getByText("Note survives for Ada")).toBeVisible();
    await expect(app.locator('[role="separator"]')).toHaveCount(1);
  });

  test("preserves runtime inputs while editing the current state and clears them only on reset", async ({ page }) => {
    await openTool(page);
    const app = appFrame(page);

    await page.locator('[data-id="login"]').click();
    await app.locator(".field").filter({ hasText: "email" }).locator("input").fill("draft@example.com");
    await app.locator(".field").filter({ hasText: "password" }).locator("input").fill("draft-secret");

    await page.locator('[data-id="login"] .node-edit').click();
    await expect(page.locator("#pData")).toBeVisible();
    await page.locator("#pData").fill('{"helperText":"Resume safely"}');
    await page.locator("#pEnterLayer").click();
    await addComponentState(page, "Note");
    await componentEditor(page, "Note").locator("textarea").fill("Helper: {{helperText}}");
    await page.keyboard.press("Alt+ArrowLeft");

    await expect(app.getByText("Helper: Resume safely")).toBeVisible();
    await expect(app.locator(".field").filter({ hasText: "email" }).locator("input")).toHaveValue("draft@example.com");
    await expect(app.locator(".field").filter({ hasText: "password" }).locator("input")).toHaveValue("draft-secret");

    await page.getByRole("button", { name: "Reset App" }).click();
    await expect(app.locator("#statePill")).toHaveText("auth_start");
    await page.locator('[data-id="login"]').click();
    await expect(app.locator(".field").filter({ hasText: "email" }).locator("input")).toHaveValue("");
    await expect(app.locator(".field").filter({ hasText: "password" }).locator("input")).toHaveValue("");
    await expect(app.getByText("Helper: Resume safely")).toBeVisible();
  });

  test("loads the default model and starts preview from a selected state", async ({ page }) => {
    await openTool(page);

    await expect(appFrame(page).getByRole("heading", { name: "Auth start" })).toBeVisible();

    await page.locator('[data-id="login"]').click();

    await expect(appFrame(page).locator("#statePill")).toHaveText("login");
    await expect(appFrame(page).getByRole("heading", { name: "Login" })).toBeVisible();
    await expect(page.locator('[data-id="login"]')).toHaveClass(/active/);
  });

  test("keeps the DOM and SVG map renderer as the fallback path", async ({ page }) => {
    await page.addInitScript(key => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      const nativeGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, options) {
        const context = nativeGetContext.call(this, type, options);
        if (this.id === "mapCanvas" && context) {
          try {
            Object.defineProperty(context, "drawElementImage", { value: undefined, configurable: true });
          } catch (_) {}
        }
        return context;
      };
    }, STORAGE_KEY);

    await page.goto("/state.html");
    await expect(page.locator('[data-id="auth_start"]')).toBeVisible();
    await expect(page.locator("#map")).toHaveAttribute("data-canvas-renderer", "dom");
    await expect(page.locator("#mapCanvas")).toBeHidden();
    await expect.poll(() => page.locator("#mapScene").evaluate(el => el.parentElement?.id)).toBe("map");
  });

  test("uses HTML-in-Canvas when drawElementImage is available", async ({ page }) => {
    await page.addInitScript(key => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      const drawElementImage = function(element, x, y) {
        window.__htmlInCanvasDraws = (window.__htmlInCanvasDraws || 0) + 1;
        window.__htmlInCanvasLastDraw = { id: element.id, x, y };
        return new DOMMatrix();
      };
      const nativeGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, options) {
        const context = nativeGetContext.call(this, type, options);
        if (this.id === "mapCanvas" && type === "2d" && context) {
          try {
            Object.defineProperty(context, "drawElementImage", { value: drawElementImage, configurable: true });
          } catch (_) {
            context.drawElementImage = drawElementImage;
          }
        }
        return context;
      };
      HTMLCanvasElement.prototype.requestPaint = function() {
        this.dispatchEvent(new Event("paint"));
      };
    }, STORAGE_KEY);

    await page.goto("/state.html");
    await expect(page.locator("#map")).toHaveAttribute("data-canvas-renderer", "html-in-canvas");
    await expect(page.locator("#mapCanvas")).toBeVisible();
    await expect(page.locator(".node")).toHaveCount(4);
    await expect.poll(() => page.locator("#mapScene").evaluate(el => el.parentElement?.id)).toBe("mapCanvas");
    await expect.poll(() => page.evaluate(() => window.__htmlInCanvasDraws || 0)).toBeGreaterThan(0);
    await expect(page.locator("#mapCanvas")).toHaveAttribute("data-drawn", "true");
    await expect.poll(() => page.evaluate(() => window.__htmlInCanvasLastDraw)).toEqual({ id: "mapScene", x: 0, y: 0 });
  });

  test("selects states from the canvas and focuses title only from the edit action", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
    await expect(page.locator("#stateInspectorBody")).toBeVisible();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Login");
    await expect(page.locator("#pTitle")).toHaveValue("Login");
    await expect(page.locator("#pTitle")).toHaveAttribute("tabindex", "0");
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(false);
    await expect.poll(() => page.locator("#map").evaluate(el => document.activeElement === el)).toBe(true);
    await expect(page.locator('[data-id="login"]')).toHaveClass(/selected/);
    await expect(appFrame(page).locator("#statePill")).toHaveText("login");

    await page.locator('[data-id="login"] .node-edit').click();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);
    await page.locator("#pTitle").fill("Sign in");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in");
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Sign in");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login").title;
    }).toBe("Sign in");

    await page.keyboard.press("Enter");
    await expect(page.locator("#pTitle")).toHaveCount(0);
    await expect(page.locator("#stateInspectorBody")).toContainText("No state selected");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in");

    const reloaded = await page.context().newPage();
    await reloaded.goto("/state.html");
    await expect(reloaded.locator('[data-id="login"] .title')).toHaveText("Sign in");
    await reloaded.locator('[data-id="login"] .node-edit').click();
    await expect(reloaded.locator("#pTitle")).toHaveValue("Sign in");
    await expect.poll(() => reloaded.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);
    await reloaded.close();
  });

  test("keeps inspector collapsible and switches between state and transition properties", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').click();
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect(page.locator("#pTitle")).toHaveValue("Login");
    const mapBefore = await visibleBox(page.locator("#map"));

    await page.locator("#btnToggleInspector").click();
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await expect(page.locator("#btnToggleInspector")).toHaveAttribute("aria-label", "Expand state inspector");
    await expect(page.locator("#pTitle")).toBeHidden();
    const mapCollapsed = await visibleBox(page.locator("#map"));
    expect(mapCollapsed.width).toBeGreaterThan(mapBefore.width);

    await page.locator('[data-id="register"]').click();
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await expect(page.locator("#stateInspector")).toHaveClass(/inspector-pulse/);
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Register");
    await expect(page.locator("#pTitle")).toBeHidden();

    await page.locator("#btnToggleInspector").click();
    await expect(page.locator(".workspace")).not.toHaveClass(/inspector-collapsed/);
    await expect(page.locator("#pTitle")).toHaveValue("Register");

    const label = page.locator("svg text.edge-label").filter({ hasText: "Login" });
    await expect(label).toHaveCount(1);
    await page.locator("#btnToggleInspector").click();
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await label.click();
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await expect(page.locator("#stateInspector")).toHaveClass(/transition-inspector/);
    await expect(page.locator("#stateInspector")).toHaveClass(/inspector-pulse/);
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Transition: Login");
    await expect(page.locator("#pLabel")).toBeHidden();
    await page.locator("#btnToggleInspector").click();
    await expect(page.locator("#pLabel")).toBeVisible();
    await expect(page.locator("#pTitle")).toHaveCount(0);
    await expect(page.locator("#stateInspector")).toHaveClass(/transition-inspector/);
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Transition: Login");

    await page.keyboard.press("Escape");
    await page.locator('[data-id="register"]').click();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Register");
    await expect(page.locator("#pTitle")).toHaveValue("Register");
  });

  test("persists desktop panel and explorer layout across reopening", async ({ page }) => {
    await openTool(page);

    await page.locator("#btnToggleInspector").click();
    await page.locator("#btnTogglePreview").click();
    await page.locator("#btnToggleStateExplorer").click();
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await expect(page.locator(".workspace")).toHaveClass(/preview-collapsed/);
    await expect(page.locator("#stateExplorer")).toHaveClass(/collapsed/);

    const uiState = await savedUiState(page);
    expect(uiState).toMatchObject({
      inspectorCollapsed: true,
      previewCollapsed: true,
      stateExplorerCollapsed: true,
      mobileWorkspaceView: "canvas"
    });

    const reopened = await page.context().newPage();
    await reopened.goto("/state.html");
    await expect(reopened.locator('[data-id="auth_start"]')).toBeVisible();
    await expect(reopened.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await expect(reopened.locator(".workspace")).toHaveClass(/preview-collapsed/);
    await expect(reopened.locator("#stateExplorer")).toHaveClass(/collapsed/);
    await reopened.close();
  });

  test("sizes each node to fit its title instead of truncating with ellipsis", async ({ page }) => {
    await openTool(page);
    const longTitle = "Collect detailed learner preferences before recommending lessons";

    const registerBefore = await visibleBox(page.locator('[data-id="register"]'));
    await page.locator('[data-id="login"] .node-edit').click();
    await expect(page.locator("#pTitle")).toHaveValue("Login");
    await page.locator("#pTitle").fill(longTitle);
    await expect(page.locator("#pTitle")).toHaveValue(longTitle);
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login").title;
    }).toBe(longTitle);

    const login = page.locator('[data-id="login"]');
    await expect(login.locator(".title")).toHaveText(longTitle);
    await expect(login.locator(".title")).toHaveCSS("text-overflow", "clip");

    const loginBox = await visibleBox(login);
    expect(loginBox.width).toBeGreaterThan(registerBefore.width + 160);

    const output = await centerOf(login.locator(".port"));
    expect(Math.abs(output.x - (loginBox.x + loginBox.width))).toBeLessThan(3);

    await page.getByRole("button", { name: "Fit" }).click();
    await assertVisibleInViewport(page, '[data-id="login"]');
  });

  test("keeps state status badges away from the Open node action", async ({ page }) => {
    await openTool(page);

    const chrome = await page.locator('[data-id="auth_start"]').evaluate(node => {
      const rectFor = selector => {
        const el = node.querySelector(selector);
        const style = el ? getComputedStyle(el) : null;
        if (!el || style.display === "none") return null;
        const rect = el.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom
        };
      };
      const overlaps = (a, b) => Boolean(a && b &&
        a.left < b.right &&
        a.right > b.left &&
        a.top < b.bottom &&
        a.bottom > b.top
      );
      const open = rectFor(".node-open");
      const initial = rectFor(".badge");
      const live = rectFor(".live-badge");
      return {
        open,
        initial,
        live,
        initialOverlapsOpen: overlaps(initial, open),
        liveOverlapsOpen: overlaps(live, open)
      };
    });

    expect(chrome.open).toBeTruthy();
    expect(chrome.initial).toBeTruthy();
    expect(chrome.initialOverlapsOpen).toBe(false);
    expect(chrome.liveOverlapsOpen).toBe(false);
    expect(chrome.initial.right).toBeLessThan(chrome.open.left);
  });

  test("snaps nodes, ports, and transition paths exactly to the canvas grid", async ({ page }) => {
    await openTool(page);

    const assertGridGeometry = async () => {
      const [report, model] = await Promise.all([gridGeometryReport(page), savedModel(page)]);
      const nodes = new Map(report.nodes.map(node => [node.id, node]));

      for (const node of report.nodes) {
        for (const value of [node.left, node.top, node.width, node.height, node.input.x, node.input.y, node.output.x, node.output.y]) {
          expect(value % GRID_SIZE).toBe(0);
        }
      }

      for (const path of report.paths) {
        const transition = model.transitions.find(item => item.id === path.id);
        expect(transition).toBeTruthy();
        const from = nodes.get(transition.from);
        const to = nodes.get(transition.to);
        const first = path.points[0];
        const last = path.points[path.points.length - 1];
        const outPin = report.pins.find(pin => pin.id === path.id && pin.side === "out");
        const inPin = report.pins.find(pin => pin.id === path.id && pin.side === "in");

        expect(path.usesOnlyGridLines).toBe(true);
        expect(path.allPointsOnGrid).toBe(true);
        expect(path.allSegmentsOrthogonal).toBe(true);
        expect(outPin).toBeTruthy();
        expect(inPin).toBeTruthy();
        expect(first).toEqual({ x: outPin.x, y: outPin.y });
        expect(last).toEqual({ x: inPin.x, y: inPin.y });
        expect(first.x).toBe(from.output.x);
        expect(last.x).toBe(to.input.x);
        expect(first.y % GRID_SIZE).toBe(0);
        expect(last.y % GRID_SIZE).toBe(0);
      }

      for (const state of model.states) {
        const outgoing = model.transitions.filter(transition => transition.from === state.id);
        const incoming = model.transitions.filter(transition => transition.to === state.id);
        const outStarts = outgoing
          .map(transition => report.paths.find(path => path.id === transition.id)?.points[0])
          .filter(Boolean)
          .map(point => `${point.x},${point.y}`);
        const inEnds = incoming
          .map(transition => report.paths.find(path => path.id === transition.id)?.points.at(-1))
          .filter(Boolean)
          .map(point => `${point.x},${point.y}`);

        expect(new Set(outStarts).size).toBe(outStarts.length);
        expect(new Set(inEnds).size).toBe(inEnds.length);
      }
    };

    await assertGridGeometry();

    const login = page.locator('[data-id="login"]');
    const box = await visibleBox(login);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 37, box.y + box.height / 2 + 29, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => {
      const model = await savedModel(page);
      const state = model.states.find(item => item.id === "login");
      return [state.x % GRID_SIZE, state.y % GRID_SIZE];
    }).toEqual([0, 0]);
    await assertGridGeometry();
  });

  test("renders shared transition pins on distinct grid lanes", async ({ page }) => {
    await openTool(page);

    const [report, model] = await Promise.all([gridGeometryReport(page), savedModel(page)]);
    const paths = new Map(report.paths.map(path => [path.id, path]));
    const transitionPath = (from, to) => {
      const transition = model.transitions.find(item => item.from === from && item.to === to);
      expect(transition).toBeTruthy();
      const path = paths.get(transition.id);
      expect(path).toBeTruthy();
      return path;
    };
    const startLogin = transitionPath("auth_start", "login");
    const startRegister = transitionPath("auth_start", "register");
    const loginSuccess = transitionPath("login", "logged_in");
    const registerSuccess = transitionPath("register", "logged_in");

    expect(startLogin.points[0].x).toBe(startRegister.points[0].x);
    expect(startLogin.points[0].y).not.toBe(startRegister.points[0].y);
    expect(startLogin.points[1].y).not.toBe(startRegister.points[1].y);
    const authStartOutputSlots = report.portSlots.filter(slot => slot.nodeId === "auth_start" && slot.side === "out");
    expect(authStartOutputSlots).toHaveLength(2);
    expect(new Set(authStartOutputSlots.map(slot => slot.y)).size).toBe(2);
    expect(Math.min(...authStartOutputSlots.map(slot => slot.zIndex))).toBeGreaterThan(8);
    for (const path of [startLogin, startRegister]) {
      const slot = authStartOutputSlots.find(item => item.id === path.id);
      expect(slot).toBeTruthy();
      expect({ x: slot.x, y: slot.y }).toEqual(path.points[0]);
      expect(slot.fill).toBe(path.stroke);
    }

    const loginEnd = loginSuccess.points.at(-1);
    const registerEnd = registerSuccess.points.at(-1);
    expect(loginEnd.x).toBe(registerEnd.x);
    expect(loginEnd.y).not.toBe(registerEnd.y);
    const loggedInInputSlots = report.portSlots.filter(slot => slot.nodeId === "logged_in" && slot.side === "in");
    expect(loggedInInputSlots).toHaveLength(2);
    expect(new Set(loggedInInputSlots.map(slot => slot.y)).size).toBe(2);
    expect(Math.min(...loggedInInputSlots.map(slot => slot.zIndex))).toBeGreaterThan(8);
    for (const path of [loginSuccess, registerSuccess]) {
      const slot = loggedInInputSlots.find(item => item.id === path.id);
      expect(slot).toBeTruthy();
      expect({ x: slot.x, y: slot.y }).toEqual(path.points.at(-1));
      expect(slot.fill).toBe(path.stroke);
    }

    for (const transition of model.transitions.filter(item =>
      item.from === "auth_start" ||
      item.to === "logged_in"
    )) {
      expect(report.pins.filter(pin => pin.id === transition.id)).toHaveLength(2);
    }
  });

  test("keeps input arrowheads entering ports from the left after vertical detours", async ({ page }) => {
    await openTool(page);

    const [report, model] = await Promise.all([gridGeometryReport(page), savedModel(page)]);
    const detouredIds = new Set(model.transitions
      .filter(transition =>
        (transition.from === "logged_out" && transition.to === "login") ||
        (transition.from === "error" && transition.to === "auth_start")
      )
      .map(transition => transition.id));
    const detouredPaths = report.paths.filter(path => detouredIds.has(path.id));

    expect(detouredPaths).toHaveLength(2);
    for (const path of detouredPaths) {
      const end = path.points.at(-1);
      const beforeEnd = path.points.at(-2);
      const arrow = report.arrows.find(item => item.id === path.id);

      expect(beforeEnd.y).toBe(end.y);
      expect(beforeEnd.x).toBeLessThan(end.x);
      expect(arrow).toBeTruthy();
      expect(arrow.points[0]).toEqual(end);
      expect(Math.max(...arrow.points.slice(1).map(point => point.x))).toBeLessThan(end.x);
    }
  });

  test("separates overlapping horizontal and vertical cable lanes and colors each path", async ({ page }) => {
    const crossingModel = {
      version: 2,
      name: "Cable management",
      initial: "a",
      states: [
        { id: "a", title: "A", body: "Upper left", x: 96, y: 96 },
        { id: "b", title: "B", body: "Upper right", x: 600, y: 96 },
        { id: "c", title: "C", body: "Lower left", x: 96, y: 288 },
        { id: "d", title: "D", body: "Lower right", x: 600, y: 288 },
        { id: "s", title: "S", body: "Shared source", x: 96, y: 528 },
        { id: "t1", title: "T1", body: "First target", x: 600, y: 720 },
        { id: "t2", title: "T2", body: "Second target", x: 600, y: 768 }
      ],
      transitions: [
        { id: "a_to_d", from: "a", to: "d", label: "A to D", condition: "" },
        { id: "c_to_b", from: "c", to: "b", label: "C to B", condition: "" },
        { id: "s_to_t1", from: "s", to: "t1", label: "S to T1", condition: "" },
        { id: "s_to_t2", from: "s", to: "t2", label: "S to T2", condition: "" }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
    }, { key: STORAGE_KEY, model: crossingModel });
    await page.goto("/state.html");
    await expect(page.locator(".node")).toHaveCount(7);

    const report = await gridGeometryReport(page);
    const paths = new Map(report.paths.map(path => [path.id, path]));
    const diagonalDown = paths.get("a_to_d");
    const diagonalUp = paths.get("c_to_b");
    const sharedSourceFirst = paths.get("s_to_t1");
    const sharedSourceSecond = paths.get("s_to_t2");

    expect(diagonalDown.stroke).not.toBe(diagonalUp.stroke);
    expect(report.pins.filter(pin => pin.id === "a_to_d").map(pin => pin.fill)).toEqual([diagonalDown.stroke, diagonalDown.stroke]);
    expect(report.pins.filter(pin => pin.id === "c_to_b").map(pin => pin.fill)).toEqual([diagonalUp.stroke, diagonalUp.stroke]);
    expect(report.arrows.find(arrow => arrow.id === "a_to_d")?.fill).toBe(diagonalDown.stroke);
    expect(report.arrows.find(arrow => arrow.id === "c_to_b")?.fill).toBe(diagonalUp.stroke);

    const longestHorizontal = path => path.horizontalSegments
      .slice()
      .sort((a, b) => (b.max - b.min) - (a.max - a.min))[0];
    expect(longestHorizontal(diagonalDown).coordinate).not.toBe(longestHorizontal(diagonalUp).coordinate);

    const firstVertical = path => path.verticalSegments
      .slice()
      .sort((a, b) => a.coordinate - b.coordinate)[0];
    expect(firstVertical(sharedSourceFirst).coordinate).not.toBe(firstVertical(sharedSourceSecond).coordinate);

    const segments = report.paths.flatMap(path => path.segments.map(segment => ({ ...segment, pathId: path.id })));
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const a = segments[i];
        const b = segments[j];
        if (a.pathId === b.pathId || a.orientation !== b.orientation || a.coordinate !== b.coordinate) continue;
        const overlaps = Math.max(a.min, b.min) < Math.min(a.max, b.max);
        expect(overlaps).toBe(false);
      }
    }
  });

  test("renders an unobstructed aligned horizontal transition as a straight direct path", async ({ page }) => {
    const directModel = {
      version: 2,
      name: "Direct path",
      initial: "left",
      states: [
        { id: "left", title: "Left", body: "", x: 96, y: 192 },
        { id: "right", title: "Right", body: "", x: 504, y: 192 }
      ],
      transitions: [
        { id: "left_to_right", from: "left", to: "right", label: "Direct", condition: "" }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
    }, { key: STORAGE_KEY, model: directModel });
    await page.goto("/state.html");
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(2);

    const report = await gridGeometryReport(page);
    const route = report.paths.find(path => path.id === "left_to_right");
    const nodes = new Map(report.nodes.map(node => [node.id, node]));

    expect(route).toBeTruthy();
    expect(route.points).toHaveLength(2);
    expect(route.points[0]).toEqual(nodes.get("left").output);
    expect(route.points[1]).toEqual(nodes.get("right").input);
    expect(route.points[0].y).toBe(route.points[1].y);
    expect(route.horizontalSegments).toHaveLength(1);
    expect(route.verticalSegments).toHaveLength(0);
  });

  test("uses a short forward bend instead of looping for slightly offset transitions", async ({ page }) => {
    const nearDirectModel = {
      version: 2,
      name: "Short bend path",
      initial: "left",
      states: [
        { id: "left", title: "Left", body: "", x: 96, y: 192 },
        { id: "right", title: "Right", body: "", x: 504, y: 216 }
      ],
      transitions: [
        { id: "left_to_right", from: "left", to: "right", label: "Short", condition: "" }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
    }, { key: STORAGE_KEY, model: nearDirectModel });
    await page.goto("/state.html");
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(2);

    const report = await gridGeometryReport(page);
    const route = report.paths.find(path => path.id === "left_to_right");
    const nodes = new Map(report.nodes.map(node => [node.id, node]));
    const startY = nodes.get("left").output.y;
    const endY = nodes.get("right").input.y;

    expect(route).toBeTruthy();
    expect(route.points).toHaveLength(4);
    expect(route.verticalSegments).toHaveLength(1);
    expect(route.horizontalSegments).toHaveLength(2);
    expect(route.points.every(point => point.y >= Math.min(startY, endY) && point.y <= Math.max(startY, endY))).toBe(true);
    expect(report.arrows.find(arrow => arrow.id === "left_to_right")?.fill).toBe(route.stroke);
  });

  test("keeps clear offset transitions on a long port-stub route", async ({ page }) => {
    const offsetModel = {
      version: 2,
      name: "Clean offset route",
      initial: "left",
      states: [
        { id: "left", title: "Left", body: "", x: 96, y: 96 },
        { id: "right", title: "Right", body: "", x: 744, y: 384 }
      ],
      transitions: [
        { id: "left_to_right", from: "left", to: "right", label: "Clean", condition: "" }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
    }, { key: STORAGE_KEY, model: offsetModel });
    await page.goto("/state.html");
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(2);

    const report = await gridGeometryReport(page);
    const route = report.paths.find(path => path.id === "left_to_right");

    expect(route).toBeTruthy();
    expect(route.points).toHaveLength(4);
    expect(route.verticalSegments).toHaveLength(1);
    expect(route.horizontalSegments).toHaveLength(2);

    const [start, outStub, inputLane, end] = route.points;
    expect(outStub).toEqual({ x: start.x + GRID_SIZE * 2, y: start.y });
    expect(inputLane).toEqual({ x: outStub.x, y: end.y });
    expect(route.horizontalSegments.some(segment => segment.max - segment.min >= GRID_SIZE * 18)).toBe(true);
  });

  test("routes transition cables around state bounding boxes", async ({ page }) => {
    const obstacleModel = {
      version: 2,
      name: "Obstacle routing",
      initial: "left",
      states: [
        { id: "left", title: "Left", body: "", x: 96, y: 96 },
        { id: "middle", title: "Middle obstacle", body: "A state in the way", x: 384, y: 144 },
        { id: "right", title: "Right", body: "", x: 696, y: 96 }
      ],
      transitions: [
        { id: "left_to_right", from: "left", to: "right", label: "Around", condition: "" }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
    }, { key: STORAGE_KEY, model: obstacleModel });
    await page.goto("/state.html");
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(3);

    const [report, model] = await Promise.all([gridGeometryReport(page), savedModel(page)]);
    const transition = model.transitions.find(item => item.id === "left_to_right");
    const route = report.paths.find(path => path.id === "left_to_right");
    const obstacle = report.nodes.find(node => node.id === "middle");
    expect(transition).toBeTruthy();
    expect(route).toBeTruthy();
    expect(obstacle).toBeTruthy();
    expect(route.allPointsOnGrid).toBe(true);
    expect(route.allSegmentsOrthogonal).toBe(true);

    for (const node of report.nodes.filter(item => item.id !== transition.from && item.id !== transition.to)) {
      for (const segment of route.segments) {
        expect(segmentIntersectsNode(segment, node, GRID_SIZE / 2)).toBe(false);
      }
    }

    const bypassesObstacle = route.points.some(point => point.y < obstacle.top || point.y > obstacle.top + obstacle.height);
    expect(bypassesObstacle).toBe(true);
  });

  test("keeps transition cables clear of nearby state bounding boxes", async ({ page }) => {
    const clearanceModel = {
      version: 2,
      name: "Clearance routing",
      initial: "left",
      states: [
        { id: "left", title: "Left", body: "", x: 96, y: 96 },
        { id: "middle", title: "Middle obstacle", body: "", x: 384, y: 240 },
        { id: "right", title: "Right", body: "", x: 696, y: 288 }
      ],
      transitions: [
        { id: "left_to_right", from: "left", to: "right", label: "Avoid box", condition: "" }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
    }, { key: STORAGE_KEY, model: clearanceModel });
    await page.goto("/state.html");
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(3);

    const [report, model] = await Promise.all([gridGeometryReport(page), savedModel(page)]);
    const transition = model.transitions.find(item => item.id === "left_to_right");
    const route = report.paths.find(path => path.id === "left_to_right");
    const obstacle = report.nodes.find(node => node.id === "middle");

    expect(route).toBeTruthy();
    expect(obstacle).toBeTruthy();
    expect(route.allSegmentsOrthogonal).toBe(true);
    for (const segment of route.segments) {
      expect(segmentIntersectsNode(segment, obstacle, GRID_SIZE / 2)).toBe(false);
    }
    expect(route.points.some(point => point.y < obstacle.top - GRID_SIZE / 2 || point.y > obstacle.top + obstacle.height + GRID_SIZE / 2)).toBe(true);
    expect(transition).toBeTruthy();
  });

  test("uses tool undo and redo even when an editor input is focused", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').click();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await page.locator("#pTitle").fill("Sign in");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in");
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Control+KeyZ");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Login");

    await page.keyboard.press("Control+KeyY");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in");
  });

  test("keeps state editor focus and tab order predictable", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').click();
    await expect(page.locator("#pTitle")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pData")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pDataSourceUrl")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pRepeatPath")).toHaveAttribute("tabindex", "0");
    await expect(componentEditor(page, "Text").getByRole("button", { name: "Delete" })).toHaveAttribute("tabindex", "0");
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pData").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pDataSourceUrl").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pDataSourceTarget").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pDataSourceSelect").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pRepeatPath").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pRepeatAs").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pRepeatIndex").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => componentEditor(page, "Text").getByRole("button", { name: "Delete" }).evaluate(el => document.activeElement === el)).toBe(true);
  });

  test("keeps transition editor focus, tab order, and Enter commit close predictable", async ({ page }) => {
    await openTool(page);

    const label = page.locator("svg text.edge-label").filter({ hasText: "Login" });
    await expect(label).toHaveCount(1);
    await label.click();

    await expect(page.locator("#pLabel")).toBeVisible();
    await expect(page.locator("#pLabel")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pCond")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pSet")).toHaveAttribute("tabindex", "0");
    await expect.poll(() => page.locator("#pLabel").evaluate(el => document.activeElement === el)).toBe(true);
    await expect.poll(() => page.locator("#pLabel").evaluate(el => ({
      value: el.value,
      selectionStart: el.selectionStart,
      selectionEnd: el.selectionEnd
    }))).toEqual({
      value: "Login",
      selectionStart: 0,
      selectionEnd: 5
    });
    await page.keyboard.type("Sign in action");
    await expect(page.locator("#pLabel")).toHaveValue("Sign in action");

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pTriggerType").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pTriggerEvent").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pTriggerTimer").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pCond").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => page.locator("#pTriggerTimer").evaluate(el => document.activeElement === el)).toBe(true);

    await page.locator("#pLabel").focus();
    await expect.poll(() => page.locator("#pLabel").evaluate(el => document.activeElement === el)).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.locator("#pLabel")).toHaveCount(0);
    await expect(page.locator("#stateInspectorBody")).toContainText("No state selected");
    await expect(page.locator("svg text.edge-label").filter({ hasText: "Sign in action" })).toHaveCount(1);
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.transitions.find(transition => transition.from === "auth_start" && transition.to === "login")?.label;
    }).toBe("Sign in action");
  });

  test("keeps Delete native inside focused editors and deletes selected canvas items after commit", async ({ page }) => {
    await openTool(page);
    const loginEdgeId = await savedModel(page).then(model =>
      model.transitions.find(t => t.from === "auth_start" && t.to === "login").id
    );
    const loginEdge = page.locator(`.edge[data-edge-id="${loginEdgeId}"]`);
    const loginLabel = page.locator(`.edge-label[data-edge-id="${loginEdgeId}"]`);

    await loginLabel.click();
    await expect(loginEdge).toHaveClass(/selected/);
    await expect(loginLabel).toHaveClass(/selected/);
    await expect(page.locator("#pLabel")).toBeVisible();
    await expect.poll(() => page.locator("#pLabel").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Delete");
    await expect(page.locator("#pLabel")).toHaveValue("");
    await expect(loginEdge).toHaveCount(1);
    await expect(loginEdge).toHaveClass(/selected/);
    await expect(loginLabel).toHaveText("To Login");

    await page.keyboard.press("Enter");
    await expect(page.locator("#pLabel")).toHaveCount(0);
    await page.keyboard.press("Delete");
    await expect(loginEdge).toHaveCount(0);
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.transitions.some(t => t.id === loginEdgeId);
    }).toBe(false);

    await openTool(page);
    const login = page.locator('[data-id="login"]');
    await page.locator('[data-id="login"] .node-edit').click();
    await expect(login).toHaveClass(/selected/);
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await expect(login).toHaveCount(1);
    await expect(login).toHaveClass(/selected/);
    await expect(page.locator("#pTitle")).toHaveValue("");

    await page.keyboard.press("Enter");
    await expect(page.locator("#stateInspectorBody")).toContainText("No state selected");
    await login.click();
    await expect(login).toHaveClass(/selected/);
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(false);
    await expect.poll(() => page.locator("#map").evaluate(el => document.activeElement === el)).toBe(true);
    await page.keyboard.press("Delete");
    await expect(login).toHaveCount(0);
    await expect(page.locator("#pTitle")).toHaveCount(0);
    await expect(page.locator("#stateInspectorBody")).toContainText("No state selected");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return {
        hasLogin: model.states.some(state => state.id === "login"),
        linkedToLogin: model.transitions.some(t => t.from === "login" || t.to === "login")
      };
    }).toEqual({ hasLogin: false, linkedToLogin: false });
  });

  test("highlights hovered transitions with their own cable color", async ({ page }) => {
    await openTool(page);
    const registerEdgeId = await savedModel(page).then(model =>
      model.transitions.find(t => t.from === "auth_start" && t.to === "register").id
    );
    const edge = page.locator(`.edge[data-edge-id="${registerEdgeId}"]`);
    const label = page.locator(`.edge-label[data-edge-id="${registerEdgeId}"]`);
    const pin = page.locator(`.edge-pin[data-edge-id="${registerEdgeId}"]`).first();
    const tip = page.locator(`.edge-tip-hit[data-edge-id="${registerEdgeId}"]`);
    const accent = await page.locator("body").evaluate(el => getComputedStyle(el).getPropertyValue("--accent").trim());
    const accentRgb = await page.evaluate(color => {
      const probe = document.createElement("span");
      probe.style.color = color;
      document.body.appendChild(probe);
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      return rgb;
    }, accent);
    const cableColor = await edge.evaluate(el => getComputedStyle(el).stroke);

    expect(cableColor).not.toBe(accentRgb);

    await label.hover();
    await expect(edge).toHaveClass(/hovered/);
    await expect(label).toHaveClass(/hovered/);
    await expect.poll(() => edge.evaluate(el => getComputedStyle(el).stroke)).toBe(cableColor);
    await expect.poll(() => label.evaluate(el => getComputedStyle(el).fill)).toBe(cableColor);
    await expect.poll(() => pin.evaluate(el => getComputedStyle(el).stroke)).toBe(cableColor);
    await expect.poll(() => tip.evaluate(el => getComputedStyle(el).stroke)).toBe(cableColor);
  });

  test("validates transition conditions and advances only on matching typed inputs", async ({ page }) => {
    await openTool(page);
    const app = appFrame(page);

    await page.locator('[data-id="login"]').click();
    await expect(app.locator("#statePill")).toHaveText("login");

    await app.getByRole("button", { name: "Einloggen" }).click();
    await expect(app.locator(".action.invalid").filter({ hasText: "Einloggen" }).locator(".condition-feedback"))
      .toContainText("Condition not met");
    await expect(app.locator("#statePill")).toHaveText("login");

    await app.locator(".field").filter({ hasText: "email" }).locator("input").fill("user@example.com");
    await app.locator(".field").filter({ hasText: "password" }).locator("input").fill("secret123");
    await app.getByRole("button", { name: "Einloggen" }).click();

    await expect(app.locator("#statePill")).toHaveText("logged_in");
    await expect(app.getByRole("heading", { name: "Logged in" })).toBeVisible();
  });

  test("adds while as a normal conditional self-loop preset", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "While loop");

    const model = await savedModel(page);
    const loop = model.states.find(state => state.title === "While loop");
    expect(loop).toBeTruthy();
    expect(loop.data).toEqual({ fetched: false });
    expect(loop.components[0]).toMatchObject({
      type: "note",
      text: "Repeat this state while fetched is false. Add an exit transition with condition fetched."
    });

    const loopTransitions = model.transitions.filter(transition => transition.from === loop.id && transition.to === loop.id);
    expect(loopTransitions).toHaveLength(1);
    expect(loopTransitions[0]).toMatchObject({
      label: "while !fetched",
      condition: "!fetched",
      set: {}
    });

    await expect(page.locator(`.edge[data-edge-id="${loopTransitions[0].id}"]`)).toBeVisible();
    await page.locator(`[data-id="${loop.id}"]`).click();
    await expect(appFrame(page).locator("#statePill")).toHaveText(loop.id);
  });

  test("runs while loops as conditional self-transitions with a normal exit", async ({ page }) => {
    const model = {
      version: 2,
      name: "Polling loop",
      initial: "poll",
      states: [
        {
          id: "poll",
          title: "Fetch data",
          body: "",
          x: 120,
          y: 140,
          data: { fetched: false },
          components: [{ id: "poll_note", type: "note", text: "Waiting for data", url: "" }]
        },
        {
          id: "ready",
          title: "Ready",
          body: "",
          x: 480,
          y: 140,
          data: {},
          components: [{ id: "ready_text", type: "text", text: "Data arrived", url: "" }]
        }
      ],
      transitions: [
        { id: "repeat", from: "poll", to: "poll", label: "while !fetched", condition: "!fetched", set: {} },
        { id: "done", from: "poll", to: "ready", label: "done", condition: "fetched", set: {} }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(page.locator('[data-id="poll"]')).toBeVisible();
    await expect(app.locator("#statePill")).toHaveText("poll");
    await expect(app.getByText("Waiting for data")).toBeVisible();
    await expect(app.locator(".field").filter({ hasText: "fetched" }).locator(".switch-value")).toHaveText("Off");

    await app.getByRole("button", { name: "while !fetched" }).click();
    await expect(app.locator("#statePill")).toHaveText("poll");

    await app.locator(".field").filter({ hasText: "fetched" }).locator(".switch").click();
    await expect(app.locator(".field").filter({ hasText: "fetched" }).locator(".switch-value")).toHaveText("On");

    await app.getByRole("button", { name: "while !fetched" }).click();
    await expect(app.locator(".action.invalid").filter({ hasText: "while !fetched" }).locator(".condition-feedback"))
      .toContainText("Condition not met");
    await expect(app.locator("#statePill")).toHaveText("poll");

    await app.getByRole("button", { name: "done" }).click();
    await expect(app.locator("#statePill")).toHaveText("ready");
    await expect(app.getByText("Data arrived")).toBeVisible();
  });

  test("inspects JSON endpoints and wires array fields into repeated state content", async ({ page }) => {
    await page.route("https://api.example.test/lessons", route => route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        items: [
          { title: "Alpha", url: "https://example.test/a" },
          { title: "Beta", url: "https://example.test/b" }
        ]
      })
    }));
    await openTool(page);

    await addComponentState(page, "Fetch data");
    await page.locator("#pDataSourceUrl").fill("https://api.example.test/lessons");
    await expect(page.locator("#pDataSourceInspect")).toContainText("JSON 200");
    await expect(page.getByRole("button", { name: /Use items/ })).toBeVisible();

    await page.getByRole("button", { name: /Repeat items/ }).click();
    await expect(page.locator("#pDataSourceSelect")).toHaveValue("items");
    await expect(page.locator("#pRepeatPath")).toHaveValue("fetch.data");
    await expect(page.locator("#pRepeatAs")).toHaveValue("item");
    await expect(page.locator(".binding-chip").filter({ hasText: "{{item.title}}" })).toBeVisible();

    const note = componentEditor(page, "Note").locator("textarea");
    await note.fill("");
    await note.focus();
    await page.locator(".binding-chip").filter({ hasText: "{{item.title}}" }).click();
    await expect(note).toHaveValue("{{item.title}}");

    const model = await savedModel(page);
    const fetchState = model.states.find(state => state.title === "Fetch data");
    expect(fetchState.dataSource).toMatchObject({
      url: "https://api.example.test/lessons",
      target: "fetch",
      select: "items"
    });
    expect(fetchState.repeat).toEqual({ path: "fetch.data", as: "item", index: "i" });
    expect(fetchState.components.find(component => component.type === "note").text).toBe("{{item.title}}");
  });

  test("generated app treats JSON fetch results as FSM events and renders mapped content", async ({ page }) => {
    await page.route("https://api.example.test/runtime-lessons", route => route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        items: [
          { title: "Alpha", slug: "alpha" },
          { title: "Beta", slug: "beta" }
        ]
      })
    }));
    const model = {
      version: 2,
      name: "Runtime fetch",
      initial: "load",
      states: [
        {
          id: "load",
          title: "Lessons",
          body: "",
          x: 120,
          y: 140,
          data: {},
          dataSource: {
            url: "https://api.example.test/runtime-lessons",
            target: "fetch",
            select: "items",
            timeoutMs: 2000,
            retries: 0
          },
          components: [{ id: "loading_note", type: "note", text: "Loading {{fetch.status}}", url: "" }]
        },
        {
          id: "ready",
          title: "Ready",
          body: "",
          x: 480,
          y: 140,
          data: {},
          repeat: { path: "fetch.data", as: "item", index: "i" },
          components: [
            { id: "lesson_heading", type: "heading", text: "#{{i}} {{item.title}}", url: "" },
            { id: "lesson_link", type: "link", text: "Open {{item.title}}", url: "https://example.com/{{item.slug}}" }
          ]
        }
      ],
      transitions: [
        { id: "ready_transition", from: "load", to: "ready", label: "Ready", condition: "fetch.ok && fetch.count >= 2", set: {} }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("ready");
    await expect(app.getByRole("heading", { name: "#0 Alpha" })).toBeVisible();
    await expect(app.getByRole("heading", { name: "#1 Beta" })).toBeVisible();
    await expect(app.getByRole("link", { name: "Open Alpha" })).toHaveAttribute("href", "https://example.com/alpha");
  });

  test("generated app only auto-follows transitions that reference the active fetch context", async ({ page }) => {
    await page.route("https://api.example.test/no-auto", route => route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json"
      },
      body: JSON.stringify({ ok: true })
    }));
    const model = {
      version: 2,
      name: "Manual after fetch",
      initial: "load",
      states: [
        {
          id: "load",
          title: "Load",
          body: "",
          x: 120,
          y: 140,
          data: {},
          dataSource: {
            url: "https://api.example.test/no-auto",
            target: "fetch",
            select: "",
            timeoutMs: 2000,
            retries: 0
          },
          components: [{ id: "status", type: "note", text: "Status {{fetch.status}}", url: "" }]
        },
        {
          id: "ready",
          title: "Ready",
          body: "",
          x: 480,
          y: 140,
          data: {},
          components: [{ id: "ready_text", type: "text", text: "Manual transition only", url: "" }]
        }
      ],
      transitions: [
        { id: "manual_ready", from: "load", to: "ready", label: "Manual ready", condition: "manual == false", set: {} }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(app.getByText("Status success")).toBeVisible();
    await expect(app.locator("#statePill")).toHaveText("load");

    await app.getByRole("button", { name: "Manual ready" }).click();
    await expect(app.locator("#statePill")).toHaveText("ready");
  });

  test("generated app routes failed JSON fetches through custom target conditions", async ({ page }) => {
    await page.route("https://api.example.test/fails", route => route.fulfill({
      status: 500,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json"
      },
      body: JSON.stringify({ error: "nope" })
    }));
    const model = {
      version: 2,
      name: "Fetch failure",
      initial: "load",
      states: [
        {
          id: "load",
          title: "Load users",
          body: "",
          x: 120,
          y: 140,
          data: {},
          dataSource: {
            url: "https://api.example.test/fails",
            target: "users",
            select: "",
            timeoutMs: 2000,
            retries: 0
          },
          components: [{ id: "loading", type: "note", text: "Loading users", url: "" }]
        },
        {
          id: "failed",
          title: "Failed",
          body: "",
          x: 480,
          y: 140,
          data: {},
          components: [{ id: "failed_note", type: "note", text: "Fetch failed: {{users.error}}", url: "" }]
        }
      ],
      transitions: [
        { id: "fetch_failed", from: "load", to: "failed", label: "Fetch failed", condition: "users.status == \"error\"", set: {} }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("failed");
    await expect(app.getByText("Fetch failed: HTTP 500")).toBeVisible();
  });

  test("generated app discards stale fetch events after leaving the source state", async ({ page }) => {
    let releaseFetch;
    let markFetchStarted;
    let markFetchFinished;
    const fetchStarted = new Promise(resolve => { markFetchStarted = resolve; });
    const fetchFinished = new Promise(resolve => { markFetchFinished = resolve; });
    await page.route("https://api.example.test/stale", async route => {
      markFetchStarted();
      await new Promise(release => { releaseFetch = release; });
      await route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/json"
        },
        body: JSON.stringify({ title: "Late result" })
      });
      markFetchFinished();
    });
    const model = {
      version: 2,
      name: "Stale fetch",
      initial: "load",
      states: [
        {
          id: "load",
          title: "Load",
          body: "",
          x: 120,
          y: 140,
          data: {},
          dataSource: {
            url: "https://api.example.test/stale",
            target: "fetch",
            select: "",
            timeoutMs: 2000,
            retries: 0
          },
          components: [{ id: "loading", type: "note", text: "Loading {{fetch.status}}", url: "" }]
        },
        {
          id: "skipped",
          title: "Skipped",
          body: "",
          x: 480,
          y: 80,
          data: {},
          components: [{ id: "skipped_note", type: "note", text: "Skipped before fetch finished", url: "" }]
        },
        {
          id: "ready",
          title: "Ready",
          body: "",
          x: 480,
          y: 220,
          data: {},
          components: [{ id: "ready_note", type: "note", text: "Should not be reached by stale data", url: "" }]
        }
      ],
      transitions: [
        { id: "fetch_ready", from: "load", to: "ready", label: "Ready", condition: "fetch.ok", set: {} },
        { id: "skip", from: "load", to: "skipped", label: "Skip", condition: "", set: {} },
        { id: "leak", from: "skipped", to: "ready", label: "Leak check", condition: "fetch.ok", set: {} }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await fetchStarted;
    await expect(app.locator("#statePill")).toHaveText("load");
    await app.getByRole("button", { name: "Skip" }).click();
    await expect(app.locator("#statePill")).toHaveText("skipped");

    releaseFetch();
    await fetchFinished;
    await app.getByRole("button", { name: "Leak check" }).click();
    await expect(app.locator("#statePill")).toHaveText("skipped");
    await expect(app.locator(".action.invalid").filter({ hasText: "Leak check" }).locator(".condition-feedback"))
      .toContainText("Condition not met");
  });

  test("generated app retries within the active fetch state before emitting the fetch event", async ({ page }) => {
    let attempts = 0;
    await page.route("https://api.example.test/retry", route => {
      attempts += 1;
      if (attempts === 1) {
        return route.fulfill({
          status: 503,
          headers: {
            "access-control-allow-origin": "*",
            "content-type": "application/json"
          },
          body: JSON.stringify({ error: "try again" })
        });
      }
      return route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/json"
        },
        body: JSON.stringify({ items: [{ title: "Recovered" }] })
      });
    });
    const model = {
      version: 2,
      name: "Retry fetch",
      initial: "load",
      states: [
        {
          id: "load",
          title: "Load",
          body: "",
          x: 120,
          y: 140,
          data: {},
          dataSource: {
            url: "https://api.example.test/retry",
            target: "fetch",
            select: "items",
            timeoutMs: 2000,
            retries: 1
          },
          components: [{ id: "loading", type: "note", text: "Loading {{fetch.status}}", url: "" }]
        },
        {
          id: "ready",
          title: "Ready",
          body: "",
          x: 480,
          y: 140,
          data: {},
          repeat: { path: "fetch.data", as: "item", index: "i" },
          components: [{ id: "ready_heading", type: "heading", text: "{{item.title}}", url: "" }]
        }
      ],
      transitions: [
        { id: "fetch_ready", from: "load", to: "ready", label: "Ready", condition: "fetch.ok && fetch.count == 1", set: {} }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("ready");
    await expect(app.getByRole("heading", { name: "Recovered" })).toBeVisible();
    expect(attempts).toBe(2);
  });

  test("selecting a state starts preview and keeps runtime tab order and Enter submit usable", async ({ page }) => {
    await openTool(page);
    const app = appFrame(page);

    await page.locator('[data-id="login"]').click();
    await expect(app.locator("#statePill")).toHaveText("login");
    await expect(page.locator("#pStartHere")).toHaveCount(0);
    await expect(app.locator("#readButton")).toHaveCount(0);
    await expect(app.locator("#speechRate")).toHaveCount(0);

    const email = app.locator(".field").filter({ hasText: "email" }).locator("input");
    const password = app.locator(".field").filter({ hasText: "password" }).locator("input");
    const primaryButton = app.getByRole("button", { name: "Einloggen" });

    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(false);
    await expect.poll(() => page.locator("#map").evaluate(el => document.activeElement === el)).toBe(true);
    await expect(email).toHaveAttribute("tabindex", "0");
    await expect(password).toHaveAttribute("tabindex", "0");
    await expect(primaryButton).toHaveAttribute("tabindex", "0");
    await expect(primaryButton).toHaveAttribute("data-default-action", "true");

    await email.fill("user@example.com");
    await password.fill("secret123");
    await password.press("Enter");

    await expect(app.locator("#statePill")).toHaveText("logged_in");
  });

  test("generated app preview uses the dark theme with readable controls", async ({ page }) => {
    await openTool(page);
    const app = appFrame(page);

    await page.locator('[data-id="login"]').click();
    await expect(app.locator("#statePill")).toHaveText("login");

    const theme = await app.locator("body").evaluate(body => {
      const styleOf = selector => getComputedStyle(document.querySelector(selector));
      const root = getComputedStyle(document.documentElement);
      return {
        colorScheme: root.colorScheme,
        rootBg: root.getPropertyValue("--bg").trim(),
        rootCard: root.getPropertyValue("--card").trim(),
        rootPrimary: root.getPropertyValue("--primary").trim(),
        fontFamily: root.fontFamily,
        bodyBg: getComputedStyle(body).backgroundColor,
        bodyColor: getComputedStyle(body).color,
        screenBg: styleOf("#screen").backgroundColor,
        screenBorder: styleOf("#screen").borderColor,
        titleColor: styleOf("h1").color,
        pillBg: styleOf("#statePill").backgroundColor,
        pillColor: styleOf("#statePill").color,
        buttonBg: styleOf("button").backgroundColor,
        buttonColor: styleOf("button").color,
        inputBg: styleOf(".typed-input").backgroundColor,
        inputColor: styleOf(".typed-input").color,
      };
    });

    expect(theme).toMatchObject({
      colorScheme: "dark",
      rootBg: "#020617",
      rootCard: "#06111f",
      rootPrimary: "#38bdf8",
      bodyBg: "rgb(2, 6, 23)",
      bodyColor: "rgb(229, 240, 255)",
      screenBg: "rgb(6, 17, 31)",
      screenBorder: "rgb(29, 57, 86)",
      titleColor: "rgb(248, 251, 255)",
      pillBg: "rgb(7, 19, 33)",
      pillColor: "rgb(125, 211, 252)",
      buttonBg: "rgb(56, 189, 248)",
      buttonColor: "rgb(3, 16, 31)",
      inputBg: "rgb(2, 11, 22)",
      inputColor: "rgb(229, 240, 255)",
    });
    expect(theme.fontFamily).toContain("Atkinson Hyperlegible");
    expect(theme.screenBg).not.toBe("rgb(255, 255, 255)");
    expect(theme.pillBg).not.toBe("rgb(255, 255, 255)");
  });

  test("creates a new state by dragging a transition to empty canvas", async ({ page }) => {
    await openTool(page);
    const start = await centerOf(page.locator('[data-id="auth_start"] .port'));
    const map = await page.locator("#map").boundingBox();

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(map.x + 220, map.y + map.height - 80, { steps: 12 });
    await page.mouse.up();

    await expect(page.locator(".node")).toHaveCount(7);
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => ({
      focused: document.activeElement === el,
      selectionStart: el.selectionStart,
      selectionEnd: el.selectionEnd,
      value: el.value,
      selectedAll: el.selectionStart === 0 && el.selectionEnd === el.value.length
    }))).toMatchObject({
      focused: true,
      selectionStart: 0,
      selectedAll: true,
      value: expect.stringMatching(/^State \d+$/)
    });

    await page.keyboard.type("Steuern");

    const model = await savedModel(page);
    expect(model.states).toHaveLength(7);
    const created = model.states.find(state => state.title === "Steuern");
    expect(created).toBeTruthy();
    expect(model.states.some(state => /^State \d+$/.test(state.title))).toBe(false);
    expect(model.transitions.some(t => t.from === "auth_start" && t.to === created.id)).toBeTruthy();
    await expect(page.locator(`[data-id="${created.id}"] .title`)).toHaveText("Steuern");
  });

  test("creates a clean self-loop by dragging a state's output back to its own input", async ({ page }) => {
    await openTool(page);
    await page.getByRole("button", { name: "New" }).click();
    await page.getByRole("button", { name: "Neu starten" }).click();

    const output = await centerOf(page.locator('[data-id="start"] .port'));
    const input = await centerOf(page.locator('[data-id="start"] .input-port'));

    await page.mouse.move(output.x, output.y);
    await page.mouse.down();
    await page.mouse.move(output.x + 90, output.y - 120, { steps: 6 });
    await page.mouse.move(input.x, input.y, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator(".node")).toHaveCount(1);
    const model = await savedModel(page);
    expect(model.transitions).toHaveLength(1);
    expect(model.transitions[0]).toMatchObject({ from: "start", to: "start" });

    const edge = page.locator(`.edge[data-edge-id="${model.transitions[0].id}"]`);
    await expect(edge).toBeVisible();
    const labelY = Number(await page.locator(`.edge-label[data-edge-id="${model.transitions[0].id}"]`).getAttribute("y"));
    const path = await edge.getAttribute("d");
    const numbers = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const yValues = numbers.filter((_, index) => index % 2 === 1);
    expect(Math.min(...yValues)).toBeLessThan(model.states[0].y);
    expect(labelY).toBeLessThan(model.states[0].y);

    await page.keyboard.press("Escape");
    await page.locator('[data-id="start"]').click();
    await expect(model.transitions[0].label).toBe("To Start");
    await appFrame(page).getByRole("button", { name: "To Start" }).click();
    await expect(appFrame(page).locator("#statePill")).toHaveText("start");
  });

  test("prevents duplicate transitions for the same source and target", async ({ page }) => {
    await openTool(page);
    const before = await savedModel(page);
    expect(before.transitions.filter(t => t.from === "auth_start" && t.to === "login")).toHaveLength(1);

    await dragTransition(
      page,
      page.locator('[data-id="auth_start"] .port'),
      page.locator('[data-id="login"] .input-port')
    );

    await expect(page.locator(".edge[data-edge-id]")).toHaveCount(before.transitions.length);
    await expect.poll(async () => {
      const model = await savedModel(page);
      return {
        total: model.transitions.length,
        authToLogin: model.transitions.filter(t => t.from === "auth_start" && t.to === "login").length
      };
    }).toEqual({ total: before.transitions.length, authToLogin: 1 });

    await page.keyboard.press("Escape");
    const loginEdgeId = before.transitions.find(t => t.from === "auth_start" && t.to === "login").id;
    const arrowTip = page.locator(`circle.edge-tip-hit[data-edge-id="${loginEdgeId}"]`);
    const start = await centerOf(arrowTip);
    const duplicateTarget = await centerOf(page.locator('[data-id="register"] .input-port'));
    await page.keyboard.down("Alt");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(duplicateTarget.x, duplicateTarget.y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return {
        total: model.transitions.length,
        loginTarget: model.transitions.find(t => t.id === loginEdgeId)?.to,
        authToRegister: model.transitions.filter(t => t.from === "auth_start" && t.to === "register").length
      };
    }).toEqual({ total: before.transitions.length, loginTarget: "login", authToRegister: 1 });

    await page.getByRole("button", { name: "New" }).click();
    await page.getByRole("button", { name: "Neu starten" }).click();
    const output = page.locator('[data-id="start"] .port');
    const input = page.locator('[data-id="start"] .input-port');
    const outputCenter = await centerOf(output);

    await dragTransition(page, output, input, { x: outputCenter.x + 90, y: outputCenter.y - 120 });
    await page.keyboard.press("Escape");
    await dragTransition(page, output, input, { x: outputCenter.x + 90, y: outputCenter.y - 120 });

    await expect(page.locator(".edge[data-edge-id]")).toHaveCount(1);
    await expect.poll(async () => {
      const model = await savedModel(page);
      return {
        total: model.transitions.length,
        selfLoops: model.transitions.filter(t => t.from === "start" && t.to === "start").length
      };
    }).toEqual({ total: 1, selfLoops: 1 });
  });

  test("cancels self-loop drag when released on the source body instead of input", async ({ page }) => {
    await openTool(page);
    await page.getByRole("button", { name: "New" }).click();
    await page.getByRole("button", { name: "Neu starten" }).click();

    const output = await centerOf(page.locator('[data-id="start"] .port'));
    const body = await centerOf(page.locator('[data-id="start"] .body'));

    await page.mouse.move(output.x, output.y);
    await page.mouse.down();
    await page.mouse.move(body.x, body.y, { steps: 10 });
    await page.mouse.up();

    const model = await savedModel(page);
    expect(model.states).toHaveLength(1);
    expect(model.transitions).toHaveLength(0);
    await expect(page.locator(".node")).toHaveCount(1);
    await expect(page.locator(".edge[data-edge-id]")).toHaveCount(0);
  });

  test("reroutes an existing transition from the arrowhead with Alt-drag", async ({ page }) => {
    await openTool(page);
    const loginEdgeId = await page.evaluate(key => {
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const model = stored?.model || stored;
      return model.transitions.find(t => t.from === "auth_start" && t.label === "Login").id;
    }, STORAGE_KEY);
    const arrowTip = page.locator(`circle.edge-tip-hit[data-edge-id="${loginEdgeId}"]`);
    await expect(arrowTip).toBeVisible();
    const start = await centerOf(arrowTip);
    const end = await centerOf(page.locator('[data-id="error"] .input-port'));

    await page.keyboard.down("Alt");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up("Alt");

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.transitions.find(t => t.from === "auth_start" && t.label === "Login")?.to;
    }).toBe("error");
  });

  test("reroutes an existing transition into a self-loop from the arrowhead", async ({ page }) => {
    await openTool(page);
    const loginEdgeId = await page.evaluate(key => {
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const model = stored?.model || stored;
      return model.transitions.find(t => t.from === "auth_start" && t.label === "Login").id;
    }, STORAGE_KEY);
    const arrowTip = page.locator(`circle.edge-tip-hit[data-edge-id="${loginEdgeId}"]`);
    const start = await centerOf(arrowTip);
    const ownInput = await centerOf(page.locator('[data-id="auth_start"] .input-port'));

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 80, start.y - 120, { steps: 6 });
    await page.mouse.move(ownInput.x, ownInput.y, { steps: 10 });
    await page.mouse.up();

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.transitions.find(t => t.id === loginEdgeId)?.to;
    }).toBe("auth_start");

    const edge = page.locator(`.edge[data-edge-id="${loginEdgeId}"]`);
    const path = await edge.getAttribute("d");
    const yValues = path.match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, index) => index % 2 === 1);
    const model = await savedModel(page);
    const authStart = model.states.find(state => state.id === "auth_start");
    expect(Math.min(...yValues)).toBeLessThan(authStart.y);
  });

  test("clears properties inspector on empty canvas clicks", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
    await expect(page.locator("#pTitle")).toBeVisible();
    let point = await emptyCanvasPoint(page);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator("#pTitle")).toHaveCount(0);
    await expect(page.locator("#stateInspectorBody")).toContainText("No state selected");

    const label = page.locator("svg text.edge-label").filter({ hasText: "Login" });
    await expect(label).toHaveCount(1);
    await label.click();
    await expect(page.locator("#pLabel")).toBeVisible();
    point = await emptyCanvasPoint(page);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator("#pLabel")).toHaveCount(0);
    await expect(page.locator("#stateInspectorBody")).toContainText("No state selected");
  });

  test("keeps focused state inspector stable with Escape", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').click();
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(page.locator("#pTitle")).toBeVisible();
  });

  test("toggles the state explorer with Ctrl+Space without breaking focused editing", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').click();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Control+Space");
    await expect(page.locator("#stateExplorer")).toHaveClass(/collapsed/);
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);
    await expect(page.locator("#pTitle")).toHaveValue("Login");

    await page.keyboard.press("Control+Space");
    await expect(page.locator("#stateExplorer")).not.toHaveClass(/collapsed/);
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);
  });

  test("clears state inspector on empty-canvas single tap", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 390, height: 820 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').tap();
    await expect(page.locator("#pTitle")).toBeVisible();
    await page.locator('[data-mobile-view="canvas"]').tap();
    const point = await emptyCanvasPoint(page);
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.locator("#pTitle")).toHaveCount(0);
    await expect(page.locator("#stateInspectorBody")).toContainText("No state selected");
    await context.close();
  });

  test("switches mobile workspace between canvas, edit, and app with bottom tabs", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 390, height: 820 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await openTool(page);

    await expect(page.locator("#mobileTabs")).toBeVisible();
    await expect(page.locator("#map")).toBeVisible();
    await expect(page.locator("#stateInspector")).toBeHidden();
    await expect(page.locator(".preview")).toBeHidden();
    await expect(page.locator("#stateInspectorBody")).not.toContainText("Click a state");
    await expect(page.locator("#stateInspectorBody")).not.toContainText("Drag a state");

    await page.locator('[data-mobile-view="edit"]').tap();
    await expect(page.locator("#stateInspector")).toBeVisible();
    await expect(page.locator("#map")).toBeHidden();
    await expect(page.locator(".preview")).toBeHidden();
    await expect(page.locator('[data-mobile-view="edit"]')).toHaveClass(/active/);

    await page.locator('[data-mobile-view="app"]').tap();
    await expect(page.locator(".preview")).toBeVisible();
    await expect(page.locator("#stateInspector")).toBeHidden();
    await expect(page.locator("#map")).toBeHidden();
    await expect(page.locator('[data-mobile-view="app"]')).toHaveClass(/active/);

    await page.locator('[data-mobile-view="canvas"]').tap();
    await page.locator('[data-id="login"] .node-edit').tap();
    await expect(page.locator("#stateInspector")).toBeVisible();
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect(page.locator('[data-mobile-view="edit"]')).toHaveClass(/active/);

    await context.close();
  });

  test("persists the selected mobile workspace view across reopening", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 390, height: 820 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await page.goto("/state.html");
    await expect(page.locator("#mobileTabs")).toBeVisible();

    await page.locator('[data-mobile-view="app"]').tap();
    await expect(page.locator(".preview")).toBeVisible();
    expect(await savedUiState(page)).toMatchObject({
      mobileWorkspaceView: "app",
      previewCollapsed: false
    });

    const reopened = await context.newPage();
    await reopened.goto("/state.html");
    await expect(reopened.locator("#mobileTabs")).toBeVisible();
    await expect(reopened.locator('[data-mobile-view="app"]')).toHaveClass(/active/);
    await expect(reopened.locator(".preview")).toBeVisible();
    await expect(reopened.locator("#map")).toBeHidden();
    await expect(reopened.locator("#stateInspector")).toBeHidden();
    await reopened.close();
    await context.close();
  });

  test("adds list items reliably without nested component scrolling", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
    await expect(page.locator("#pTitle")).toBeVisible();
    await page.locator("#pEnterLayer").click();
    await addComponentState(page, "List");

    const listEditor = page.locator(".component-editor").filter({ hasText: "List" });
    const itemInputs = listEditor.locator(".list-item-editor input");
    await expect(itemInputs).toHaveCount(2);

    await listEditor.locator(".component-add-item").click();
    await expect(itemInputs).toHaveCount(3);
    await expect.poll(() => itemInputs.last().evaluate(el => document.activeElement === el)).toBe(true);

    await itemInputs.last().fill("Remember me option");
    await expect.poll(async () => {
      const model = await savedModel(page);
      const list = model.states.find(state => state.parentId === "login" && state.title === "List");
      return list?.components.find(component => component.type === "list")?.text || "";
    }).toContain("Remember me option");

    await expect(page.locator("#pComponents")).toHaveCSS("overflow", "visible");
    await expect(page.locator("#pComponents")).toHaveCSS("scrollbar-width", "none");
    await expect(page.locator("#stateInspectorBody")).toHaveCSS("scrollbar-color", "rgb(49, 95, 140) rgb(7, 19, 33)");
    await expect.poll(async () => {
      const box = await page.locator("#stateInspector").boundingBox();
      return Math.round(box?.width || 0);
    }).toBeGreaterThanOrEqual(280);
  });

  test("does not reroute when Alt-drag starts from the line body", async ({ page }) => {
    await openTool(page);
    const label = page.locator("svg text.edge-label").filter({ hasText: "Login" });
    await expect(label).toHaveCount(1);
    const start = await centerOf(label);
    const end = await centerOf(page.locator('[data-id="error"] .input-port'));

    await page.keyboard.down("Alt");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up("Alt");

    const model = await savedModel(page);
    expect(model.transitions.find(t => t.from === "auth_start" && t.label === "Login")?.to).toBe("login");
  });

  test("reroutes from the arrowhead with mobile long-press", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await openTool(page);
    await page.evaluate(() => {
      model.transitions = model.transitions.filter(t => !(t.from === "auth_start" && t.to === "register"));
      saveModel();
      draw();
    });
    const loginEdgeId = await page.evaluate(key => {
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const model = stored?.model || stored;
      return model.transitions.find(t => t.from === "auth_start" && t.label === "Login").id;
    }, STORAGE_KEY);
    const arrowTip = page.locator(`circle.edge-tip-hit[data-edge-id="${loginEdgeId}"]`);
    await expect(arrowTip).toBeVisible();
    const start = await centerOf(arrowTip);
    const end = await centerOf(page.locator('[data-id="register"] .input-port'));

    await arrowTip.dispatchEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
      pointerId: 77,
      clientX: start.x,
      clientY: start.y
    });
    await page.waitForTimeout(460);
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.transitions.find(t => t.from === "auth_start" && t.label === "Login")?.to;
    }).toBe("register");
  });

  test("reroutes to a self-loop with mobile long-press", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await openTool(page);
    const loginEdgeId = await page.evaluate(key => {
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const model = stored?.model || stored;
      return model.transitions.find(t => t.from === "auth_start" && t.label === "Login").id;
    }, STORAGE_KEY);
    const arrowTip = page.locator(`circle.edge-tip-hit[data-edge-id="${loginEdgeId}"]`);
    const start = await centerOf(arrowTip);
    const ownInput = await centerOf(page.locator('[data-id="auth_start"] .input-port'));

    await arrowTip.dispatchEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
      pointerId: 88,
      clientX: start.x,
      clientY: start.y
    });
    await page.waitForTimeout(460);
    await page.mouse.move(start.x + 80, start.y - 120, { steps: 6 });
    await page.mouse.move(ownInput.x, ownInput.y, { steps: 10 });
    await page.mouse.up();

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.transitions.find(t => t.id === loginEdgeId)?.to;
    }).toBe("auth_start");
  });

  test("ignores unmodified wheel navigation and zooms with Ctrl-wheel", async ({ page }) => {
    await openTool(page);
    const mapBox = await page.locator("#map").boundingBox();
    await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    const beforeWheel = await worldTransform(page);

    await page.mouse.wheel(120, 80);
    await expect.poll(() => worldTransform(page)).toBe(beforeWheel);

    const scaleBefore = await worldScale(page);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -180);
    await page.keyboard.up("Control");

    await expect.poll(() => worldScale(page)).toBeGreaterThan(scaleBefore);
    expect(await worldTransform(page)).not.toBe(beforeWheel);
  });

  test("accumulates tiny desktop pinch wheel deltas reliably", async ({ page }) => {
    await openTool(page);
    const mapBox = await page.locator("#map").boundingBox();
    const anchor = {
      x: mapBox.x + mapBox.width * 0.42,
      y: mapBox.y + mapBox.height * 0.48
    };
    const before = await worldTransform(page);
    const scaleBefore = await worldScale(page);

    await page.locator("#map").evaluate((map, point) => {
      for (let i = 0; i < 24; i++) {
        map.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          deltaY: -1,
          clientX: point.x,
          clientY: point.y
        }));
      }
    }, anchor);

    await expect.poll(() => worldScale(page)).toBeGreaterThanOrEqual(scaleBefore * 1.06);
    expect(await worldTransform(page)).not.toBe(before);
  });

  test("zooms desktop touch pinches responsively on the canvas", async ({ page }) => {
    await openTool(page);
    const mapBox = await page.locator("#map").boundingBox();
    const center = {
      x: mapBox.x + mapBox.width / 2,
      y: mapBox.y + mapBox.height / 2
    };
    const scaleBefore = await worldScale(page);

    await page.locator("#map").evaluate((map, point) => {
      const fireOnMap = (type, pointerId, x, y) => {
        map.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
          pointerId,
          clientX: x,
          clientY: y,
          buttons: type === "pointerup" ? 0 : 1
        }));
      };
      const fireOnWindow = (type, pointerId, x, y) => {
        window.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
          pointerId,
          clientX: x,
          clientY: y,
          buttons: type === "pointerup" ? 0 : 1
        }));
      };

      fireOnMap("pointerdown", 31, point.x - 60, point.y);
      fireOnMap("pointerdown", 32, point.x + 60, point.y);
      fireOnWindow("pointermove", 31, point.x - 90, point.y);
      fireOnWindow("pointermove", 32, point.x + 90, point.y);
      fireOnWindow("pointerup", 31, point.x - 90, point.y);
      fireOnWindow("pointerup", 32, point.x + 90, point.y);
    }, center);

    await expect.poll(() => worldScale(page)).toBeGreaterThanOrEqual(scaleBefore * 1.55);
  });

  test("empty-canvas drag pans immediately; long-press enables rectangle select", async ({ page }) => {
    await openTool(page);
    const start = await emptyCanvasPoint(page);
    const beforeDrag = await worldTransform(page);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 80, start.y + 30, { steps: 6 });
    await page.mouse.up();

    await expect.poll(() => worldTransform(page)).not.toBe(beforeDrag);
    await expect(page.locator("#selectionActions")).toBeHidden();

    await page.getByRole("button", { name: "Fit" }).click();
    const nodeBoxAfterFit = await page.locator('[data-id="auth_start"]').boundingBox();
    const selectStart = await emptyCanvasPoint(page);
    const selectEnd = { x: nodeBoxAfterFit.x + nodeBoxAfterFit.width / 2, y: nodeBoxAfterFit.y + nodeBoxAfterFit.height / 2 };

    await page.mouse.move(selectStart.x, selectStart.y);
    await page.mouse.down();
    await page.waitForTimeout(410);
    await page.mouse.move(selectEnd.x, selectEnd.y, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator("#selectionActions")).toBeVisible();
    await expect(page.locator("#selectionCount")).toContainText("state");
  });

  test("keeps selected state context while panning the canvas and clears only on empty click", async ({ page }) => {
    await openTool(page);
    const login = page.locator('[data-id="login"]');
    await login.click();
    await expect(login).toHaveClass(/selected/);
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect(page.locator("#pTitle")).toHaveValue("Login");
    const beforeDrag = await worldTransform(page);

    const point = await emptyCanvasPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 90, point.y + 35, { steps: 6 });
    await page.mouse.up();

    await expect.poll(() => worldTransform(page)).not.toBe(beforeDrag);
    await expect(login).toHaveClass(/selected/);
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect(page.locator("#pTitle")).toHaveValue("Login");

    const clickPoint = await emptyCanvasPoint(page);
    await page.mouse.click(clickPoint.x, clickPoint.y);
    await expect(login).not.toHaveClass(/selected/);
    await expect(page.locator("#pTitle")).toHaveCount(0);
    await expect(page.locator("#stateInspectorBody")).toContainText("No state selected");
  });

  test("keeps selected transition context while panning the canvas and clears only on empty click", async ({ page }) => {
    await openTool(page);
    const loginEdgeId = await savedModel(page).then(model =>
      model.transitions.find(t => t.from === "auth_start" && t.to === "login").id
    );
    const edge = page.locator(`.edge[data-edge-id="${loginEdgeId}"]`);
    const label = page.locator(`.edge-label[data-edge-id="${loginEdgeId}"]`);
    await label.click();
    await expect(edge).toHaveClass(/selected/);
    await expect(label).toHaveClass(/selected/);
    await expect(page.locator("#pLabel")).toBeVisible();
    const beforeDrag = await worldTransform(page);

    const point = await emptyCanvasPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x - 80, point.y + 45, { steps: 6 });
    await page.mouse.up();

    await expect.poll(() => worldTransform(page)).not.toBe(beforeDrag);
    await expect(edge).toHaveClass(/selected/);
    await expect(page.locator("#pLabel")).toBeVisible();

    const clickPoint = await emptyCanvasPoint(page);
    await page.mouse.click(clickPoint.x, clickPoint.y);
    await expect(edge).not.toHaveClass(/selected/);
  });

  test("cancels rectangle select when the mouse leaves the browser or window focus is lost", async ({ page }) => {
    await openTool(page);
    await page.getByRole("button", { name: "Fit" }).click();

    const startSelection = async () => {
      const nodeBox = await page.locator('[data-id="auth_start"]').boundingBox();
      const selectStart = await emptyCanvasPoint(page);
      const selectEnd = { x: nodeBox.x + nodeBox.width / 2, y: nodeBox.y + nodeBox.height / 2 };
      await page.mouse.move(selectStart.x, selectStart.y);
      await page.mouse.down();
      await page.waitForTimeout(410);
      await page.mouse.move(selectEnd.x, selectEnd.y, { steps: 8 });
      await expect(page.locator("#selectRect")).toHaveCSS("display", "block");
      await expect(page.locator("#selectionActions")).toBeVisible();
    };

    await startSelection();
    await page.evaluate(() => {
      document.dispatchEvent(new MouseEvent("mouseout", {
        bubbles: true,
        buttons: 1,
        relatedTarget: null
      }));
    });
    await expect(page.locator("#selectRect")).toHaveCSS("display", "none");
    await expect(page.locator("#selectionActions")).toBeHidden();
    await page.mouse.move(20, 20);
    await expect(page.locator("#selectRect")).toHaveCSS("display", "none");
    await page.mouse.up();

    await startSelection();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(page.locator("#selectRect")).toHaveCSS("display", "none");
    await expect(page.locator("#selectionActions")).toBeHidden();
    await page.mouse.up();
  });

  test("cancels node dragging when the mouse leaves the browser or window focus is lost", async ({ page }) => {
    await openTool(page);
    const dragNode = async (id, cancelInPage) => {
      const node = page.locator(`[data-id="${id}"]`);
      const box = await visibleBox(node);
      const before = await savedModel(page).then(model => {
        const state = model.states.find(item => item.id === id);
        return { x: state.x, y: state.y };
      });

      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 72, box.y + box.height / 2 + 48, { steps: 8 });
      await expect(page.locator("#map")).toHaveClass(/dragging-state/);
      await cancelInPage();
      await expect(page.locator("#map")).not.toHaveClass(/dragging-state/);
      await expect(page.locator("#stateExplorer")).not.toHaveClass(/drag-over/);
      const cancelled = await savedModel(page).then(model => {
        const state = model.states.find(item => item.id === id);
        return { x: state.x, y: state.y };
      });
      expect(cancelled.x !== before.x || cancelled.y !== before.y).toBe(true);

      await page.mouse.move(box.x + box.width / 2 + 180, box.y + box.height / 2 + 120, { steps: 8 });
      await expect.poll(async () => {
        const model = await savedModel(page);
        const state = model.states.find(item => item.id === id);
        return { x: state.x, y: state.y };
      }).toEqual(cancelled);
      await page.mouse.up();
    };

    await dragNode("login", () => page.evaluate(() => {
      document.dispatchEvent(new MouseEvent("mouseout", {
        bubbles: true,
        buttons: 1,
        relatedTarget: null
      }));
    }));

    await dragNode("register", () => page.evaluate(() => window.dispatchEvent(new Event("blur"))));
  });

  test("keeps many connected lanes cheap while dragging a busy state node", async ({ page }) => {
    const states = [{ id: "hub", title: "Hub", body: "Many cables", x: 480, y: 336 }];
    const transitions = [];
    for (let index = 0; index < 10; index++) {
      const y = 96 + index * 72;
      states.push(
        { id: `source_${index}`, title: `Source ${index}`, body: "", x: 96, y },
        { id: `target_${index}`, title: `Target ${index}`, body: "", x: 864, y }
      );
      transitions.push(
        { id: `in_${index}`, from: `source_${index}`, to: "hub", label: `In ${index}`, condition: "" },
        { id: `out_${index}`, from: "hub", to: `target_${index}`, label: `Out ${index}`, condition: "" }
      );
    }
    const model = { version: 2, name: "Busy lanes", initial: "hub", states, transitions };

    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
      window.__stateBlueprintRouteMetrics = {};
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    for (const transition of transitions) {
      await expect(page.locator(`.edge[data-edge-id="${transition.id}"]`)).toHaveCount(1);
    }
    const initialReport = await gridGeometryReport(page);
    const hubPins = transitions.map(transition => {
      const side = transition.to === "hub" ? "in" : "out";
      return initialReport.pins.find(pin => pin.id === transition.id && pin.side === side);
    });
    expect(hubPins.every(Boolean)).toBe(true);
    expect(new Set(hubPins.map(pin => `${pin.x},${pin.y}`)).size).toBe(20);

    const hubBox = await visibleBox(page.locator('[data-id="hub"]'));
    const start = { x: hubBox.x + hubBox.width / 2, y: hubBox.y + hubBox.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.evaluate(() => { window.__stateBlueprintRouteMetrics = {}; });
    await page.mouse.move(start.x + 168, start.y + 96, { steps: 24 });
    await page.waitForTimeout(80);

    const duringDrag = await page.evaluate(() => window.__stateBlueprintRouteMetrics);
    expect(duringDrag.liveDragRouteBuilds).toBeGreaterThan(0);
    expect(duringDrag.finalRouteBuilds || 0).toBe(0);
    expect(duringDrag.obstacleSearches || 0).toBe(0);

    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__stateBlueprintRouteMetrics.finalRouteBuilds || 0)).toBeGreaterThan(0);
    for (const transition of transitions) {
      await expect(page.locator(`.edge[data-edge-id="${transition.id}"]`)).toHaveCount(1);
    }
  });

  test("keeps clear live state-drag routes identical to the released frame @smoke", async ({ page }) => {
    const routeModel = {
      version: 2,
      name: "Stable drag routes",
      initial: "source",
      states: [
        { id: "source", title: "Source", body: "", x: 120, y: 240 },
        { id: "top", title: "Top", body: "", x: 696, y: 96 },
        { id: "bottom", title: "Bottom", body: "", x: 696, y: 408 }
      ],
      transitions: [
        { id: "source_to_top", from: "source", to: "top", label: "Top", condition: "" },
        { id: "source_to_bottom", from: "source", to: "bottom", label: "Bottom", condition: "" }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
      window.__stateBlueprintRouteMetrics = {};
    }, { key: STORAGE_KEY, model: routeModel });
    await page.goto("/state.html");
    for (const transition of routeModel.transitions) {
      await expect(page.locator(`.edge[data-edge-id="${transition.id}"]`)).toHaveCount(1);
    }

    const sourceBox = await visibleBox(page.locator('[data-id="source"]'));
    const start = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.evaluate(() => { window.__stateBlueprintRouteMetrics = {}; });
    await page.mouse.move(start.x + 168, start.y + 96, { steps: 12 });
    await expect(page.locator("#map")).toHaveClass(/dragging-state/);

    const transitionIds = routeModel.transitions.map(transition => transition.id);
    const duringDrag = await page.evaluate(ids => Object.fromEntries(ids.map(id => [
      id,
      document.querySelector(`.edge[data-edge-id="${CSS.escape(id)}"]`)?.getAttribute("d") || ""
    ])), transitionIds);

    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__stateBlueprintRouteMetrics.finalRouteBuilds || 0)).toBeGreaterThan(0);
    const afterRelease = await page.evaluate(ids => Object.fromEntries(ids.map(id => [
      id,
      document.querySelector(`.edge[data-edge-id="${CSS.escape(id)}"]`)?.getAttribute("d") || ""
    ])), transitionIds);
    const metrics = await page.evaluate(() => window.__stateBlueprintRouteMetrics);

    expect(duringDrag).toEqual(afterRelease);
    expect(metrics.liveDragRouteBuilds).toBeGreaterThan(0);
    expect(metrics.obstacleSearches || 0).toBe(0);
  });

  test("keeps obstacle-rerouted live drags identical without dense grid search @smoke", async ({ page }) => {
    const routeModel = {
      version: 2,
      name: "Sparse drag routes",
      initial: "source",
      states: [
        { id: "source", title: "Source", body: "", x: 96, y: 96 },
        { id: "obstacle", title: "Obstacle", body: "", x: 384, y: 144 },
        { id: "target", title: "Target", body: "", x: 720, y: 96 }
      ],
      transitions: [
        { id: "source_to_target", from: "source", to: "target", label: "Target", condition: "" }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
      window.__stateBlueprintRouteMetrics = {};
    }, { key: STORAGE_KEY, model: routeModel });
    await page.goto("/state.html");
    await expect(page.locator('.edge[data-edge-id="source_to_target"]')).toHaveCount(1);

    const sourceBox = await visibleBox(page.locator('[data-id="source"]'));
    const start = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.evaluate(() => { window.__stateBlueprintRouteMetrics = {}; });
    await page.mouse.move(start.x + 48, start.y + 48, { steps: 14 });
    await expect(page.locator("#map")).toHaveClass(/dragging-state/);

    const duringDrag = await page.locator('.edge[data-edge-id="source_to_target"]').getAttribute("d");
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__stateBlueprintRouteMetrics.finalRouteBuilds || 0)).toBeGreaterThan(0);
    const afterRelease = await page.locator('.edge[data-edge-id="source_to_target"]').getAttribute("d");
    const metrics = await page.evaluate(() => window.__stateBlueprintRouteMetrics);

    expect(duringDrag).toBe(afterRelease);
    expect(metrics.liveDragRouteBuilds).toBeGreaterThan(0);
    expect(metrics.sparseRouteSearches).toBeGreaterThan(0);
    expect(metrics.obstacleSearches || 0).toBe(0);
  });

  test("recovers desktop drag, pan, and connection gestures when mouseup is missed", async ({ page }) => {
    await openTool(page);

    const login = page.locator('[data-id="login"]');
    const loginBox = await visibleBox(login);
    await page.mouse.move(loginBox.x + loginBox.width / 2, loginBox.y + loginBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(loginBox.x + loginBox.width / 2 + 72, loginBox.y + loginBox.height / 2 + 48, { steps: 8 });
    await expect(page.locator("#map")).toHaveClass(/dragging-state/);
    await dispatchLostDesktopMouseRelease(page);
    await expect(page.locator("#map")).not.toHaveClass(/dragging-state/);
    await expect(page.locator("#stateExplorer")).not.toHaveClass(/drag-over/);
    const dragStoppedAt = await savedModel(page).then(model => {
      const state = model.states.find(item => item.id === "login");
      return { x: state.x, y: state.y };
    });
    await page.mouse.move(loginBox.x + loginBox.width / 2 + 190, loginBox.y + loginBox.height / 2 + 130, { steps: 8 });
    await expect.poll(async () => {
      const model = await savedModel(page);
      const state = model.states.find(item => item.id === "login");
      return { x: state.x, y: state.y };
    }).toEqual(dragStoppedAt);
    await page.mouse.up();

    const panStart = await emptyCanvasPoint(page);
    await page.mouse.move(panStart.x, panStart.y);
    await page.mouse.down();
    await page.mouse.move(panStart.x - 82, panStart.y + 44, { steps: 6 });
    await expect(page.locator("#map")).toHaveClass(/panning/);
    const transformAtCancel = await worldTransform(page);
    await dispatchLostDesktopMouseRelease(page);
    await expect(page.locator("#map")).not.toHaveClass(/panning/);
    await page.mouse.move(panStart.x - 168, panStart.y + 88, { steps: 6 });
    await expect.poll(() => worldTransform(page)).toBe(transformAtCancel);
    await page.mouse.up();

    const transitionsBefore = await savedModel(page).then(model => model.transitions.length);
    const output = await centerOf(page.locator('[data-id="auth_start"] .port'));
    await page.mouse.move(output.x, output.y);
    await page.mouse.down();
    await page.mouse.move(output.x + 96, output.y + 42, { steps: 6 });
    await expect(page.locator("#map")).toHaveClass(/connecting/);
    await dispatchLostDesktopMouseRelease(page);
    await expect(page.locator("#map")).not.toHaveClass(/connecting/);
    await page.mouse.move(output.x + 220, output.y + 120, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => savedModel(page).then(model => model.transitions.length)).toBe(transitionsBefore);
  });

  test("shift-click toggles mixed selections and undo redo restores empty-canvas deselection", async ({ page }) => {
    await openTool(page);
    const loginEdgeId = await page.evaluate(key => {
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const model = stored?.model || stored;
      return model.transitions.find(t => t.from === "auth_start" && t.label === "Login").id;
    }, STORAGE_KEY);
    const login = page.locator('[data-id="login"]');
    const register = page.locator('[data-id="register"]');
    const loginEdge = page.locator(`.edge[data-edge-id="${loginEdgeId}"]`);

    await login.click();
    await expect(login).toHaveClass(/selected/);
    await expect(register).not.toHaveClass(/selected/);

    await register.click({ modifiers: ["Shift"] });
    await expect(login).toHaveClass(/selected/);
    await expect(register).toHaveClass(/selected/);
    await expect(page.locator("#selectionActions")).toBeVisible();
    await expect(page.locator("#selectionCount")).toContainText("2 states");

    await login.click({ modifiers: ["Shift"] });
    await expect(login).not.toHaveClass(/selected/);
    await expect(register).toHaveClass(/selected/);

    await page.locator(`.edge-label[data-edge-id="${loginEdgeId}"]`).click({ modifiers: ["Shift"] });
    await expect(register).toHaveClass(/selected/);
    await expect(loginEdge).toHaveClass(/selected/);

    const empty = await emptyCanvasPoint(page);
    await page.mouse.click(empty.x, empty.y);
    await expect(register).not.toHaveClass(/selected/);
    await expect(loginEdge).not.toHaveClass(/selected/);
    await expect(page.locator("#selectionActions")).toBeHidden();

    await page.keyboard.press("Control+KeyZ");
    await expect(register).toHaveClass(/selected/);
    await expect(loginEdge).toHaveClass(/selected/);

    await page.keyboard.press("Control+KeyY");
    await expect(register).not.toHaveClass(/selected/);
    await expect(loginEdge).not.toHaveClass(/selected/);
  });

  test("keeps undo redo state clean when deleting and restoring selected states", async ({ page }) => {
    await openTool(page);
    const login = page.locator('[data-id="login"]');
    const register = page.locator('[data-id="register"]');

    await login.click();
    await register.click({ modifiers: ["Shift"] });
    await expect(login).toHaveClass(/selected/);
    await expect(register).toHaveClass(/selected/);
    await expect(page.locator("#selectionActions")).toBeVisible();
    await expect(page.locator("#selectionCount")).toContainText("2 states");

    await page.keyboard.press("Delete");
    await expect(login).toHaveCount(0);
    await expect(register).toHaveCount(0);
    await expect(page.locator("#selectionActions")).toBeHidden();
    await expect(savedModel(page).then(model => model.states.some(state => state.id === "login"))).resolves.toBe(false);

    await page.keyboard.press("Control+KeyZ");
    await expect(login).toBeVisible();
    await expect(register).toBeVisible();
    await expect(login).toHaveClass(/selected/);
    await expect(register).toHaveClass(/selected/);
    await expect(page.locator("#selectionActions")).toBeVisible();
    await expect(page.locator("#selectionCount")).toContainText("2 states");
    await expect(savedModel(page).then(model => model.states.some(state => state.id === "login"))).resolves.toBe(true);

    await page.keyboard.press("Control+KeyY");
    await expect(login).toHaveCount(0);
    await expect(register).toHaveCount(0);
    await expect(page.locator("#selectionActions")).toBeHidden();
    await expect(savedModel(page).then(model => model.states.some(state => state.id === "login"))).resolves.toBe(false);
  });

  test("stores reusable states in the bottom explorer without moving or duplicating the source node", async ({ page }) => {
    await openTool(page);
    const login = page.locator('[data-id="login"]');
    const originalBox = await visibleBox(login);

    await page.locator("#btnToggleStateExplorer").click();
    await expect(page.locator("#stateExplorer")).toHaveClass(/collapsed/);

    await login.click();
    await page.locator("#pTitle").fill("Reusable login");
    await componentEditor(page, "Text").locator("textarea").fill("A reusable sign-in screen");
    await page.locator("#pData").fill('{"role":"member"}');

    await dragNodeToStateExplorer(page, login);

    const template = page.locator(".state-template-card").filter({ hasText: "Reusable login" });
    await expect(template).toBeVisible();
    await expect(page.locator("#stateExplorer")).not.toHaveClass(/collapsed/);
    await expect(page.locator(".node")).toHaveCount(4);
    await expect(login).toBeVisible();
    const afterDropBox = await visibleBox(login);
    expect(Math.abs(afterDropBox.x - originalBox.x)).toBeLessThan(2);
    expect(Math.abs(afterDropBox.y - originalBox.y)).toBeLessThan(2);

    await expect.poll(async () => {
      const templates = await savedStateTemplates(page);
      return templates.map(template => ({
        title: template.title,
        text: template.components.find(component => component.type === "text")?.text,
        role: template.data?.role
      }));
    }).toEqual([{ title: "Reusable login", text: "A reusable sign-in screen", role: "member" }]);

    await dragNodeToStateExplorer(page, login);
    await expect(page.locator(".state-template-card")).toHaveCount(1);
    await expect.poll(async () => (await savedStateTemplates(page)).length).toBe(1);

    await page.keyboard.press("Control+Space");
    await expect(page.locator("#stateExplorer")).toHaveClass(/collapsed/);
    await page.keyboard.press("Control+Space");
    await expect(page.locator("#stateExplorer")).not.toHaveClass(/collapsed/);
  });

  test("keeps canvas state drags above the explorer drop surface", async ({ page }) => {
    await openTool(page);
    const login = page.locator('[data-id="login"]');
    const nodeBox = await visibleBox(login);
    const explorerBox = await visibleBox(page.locator("#stateExplorer"));

    await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(explorerBox.x + explorerBox.width / 2, explorerBox.y + explorerBox.height / 2, { steps: 12 });

    await expect(page.locator("#map")).toHaveClass(/dragging-state/);
    await expect(page.locator("#stateExplorer")).toHaveClass(/drag-over/);
    await expect.poll(() => page.locator("#world").evaluate(el => Number(getComputedStyle(el).zIndex))).toBeGreaterThan(
      await page.locator("#stateExplorer").evaluate(el => Number(getComputedStyle(el).zIndex))
    );

    await page.mouse.up();
    await expect(page.locator("#map")).not.toHaveClass(/dragging-state/);
    await expect(page.locator(".state-template-card")).toHaveCount(1);
  });

  test("adds, edits, updates, uses, and deletes state explorer presets", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "Text");
    await page.locator("#pTitle").fill("Quick lesson");
    await componentEditor(page, "Text").locator("textarea").fill("Hello {{role}}");
    await page.locator("#pData").fill('{"role":"mentor"}');
    const sourceId = await page.locator(".node.selected").getAttribute("data-id");
    await dragNodeToStateExplorer(page, page.locator(`[data-id="${sourceId}"]`));
    const preset = page.locator(".state-template-card").first();
    await expect(preset).toHaveClass(/editing/);
    await expect(page.locator(".state-explorer-label")).toHaveCount(0);
    await expect(componentPreset(page, "Text")).toHaveAttribute("data-template-kind", "core");
    await expect(componentPreset(page, "Text").getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(preset).toHaveAttribute("data-template-kind", "user");
    await expect(preset.getByRole("button", { name: "Delete" })).toBeVisible();
    const cardColors = await page.evaluate(() => ({
      coreBorder: getComputedStyle(document.querySelector(".component-preset-card")).borderColor,
      userBorder: getComputedStyle(document.querySelector(".state-template-card")).borderColor
    }));
    expect(cardColors.coreBorder).not.toBe(cardColors.userBorder);
    await expect(preset.locator(".template-title-input")).toHaveCount(0);
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Preset: Quick lesson");
    await expect(page.locator("#stateInspector")).toHaveClass(/template-inspector/);
    await expect(page.locator("#stateInspectorBody")).toContainText("Reusable State Component");
    await expect(page.locator("#stateInspectorBody")).toContainText("Existing canvas states stay unchanged");
    await expect.poll(async () => {
      const templates = await savedStateTemplates(page);
      return {
        title: templates[0].title,
        text: templates[0].components.find(component => component.type === "text")?.text,
        data: templates[0].data
      };
    }).toEqual({
      title: "Quick lesson",
      text: "Hello {{role}}",
      data: { role: "mentor" }
    });

    await preset.getByRole("button", { name: "Use" }).click();
    await expect(page.locator(".node")).toHaveCount(8);
    await expect(page.locator("#pTitle")).toHaveValue("Quick lesson");
    await expect(componentEditor(page, "Text").locator("textarea")).toHaveValue("Hello {{role}}");
    await expect(appFrame(page).getByText("Hello mentor")).toBeVisible();

    await page.locator('[data-id="login"]').click();
    await page.locator("#pTitle").fill("Updated reusable login");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login")?.title;
    }).toBe("Updated reusable login");
    await componentEditor(page, "Text").locator("textarea").fill("Updated body {{role}}");

    await preset.getByRole("button", { name: "Update" }).click();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Preset: Updated reusable login");
    await expect.poll(async () => {
      const templates = await savedStateTemplates(page);
      return {
        title: templates[0].title,
        text: templates[0].components.find(component => component.type === "text")?.text
      };
    }).toEqual({
      title: "Updated reusable login",
      text: "Updated body {{role}}"
    });

    await expect(preset.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await preset.click();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Preset: Updated reusable login");
    await expect(page.locator("#stateInspector")).toHaveClass(/template-inspector/);
    await expect(componentEditor(page, "Text").locator("textarea")).toHaveValue("Updated body {{role}}");

    await preset.getByRole("button", { name: "Use" }).click();
    await expect(page.locator("#pTitle")).toHaveValue("Updated reusable login");
    await expect(componentEditor(page, "Text").locator("textarea")).toHaveValue("Updated body {{role}}");

    await preset.click();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Preset: Updated reusable login");
    await preset.getByRole("button", { name: "Delete" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Delete preset" });
    await expect(deleteDialog).toBeVisible();
    await expect(page.locator("#modalMessage")).toContainText("Updated reusable login");
    await deleteDialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(deleteDialog).toBeHidden();
    await expect(page.locator(".state-template-card")).toHaveCount(1);

    await preset.getByRole("button", { name: "Delete" }).click();
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole("button", { name: "Delete preset" }).click();
    await expect(page.locator(".state-template-card")).toHaveCount(0);
    await expect.poll(async () => (await savedStateTemplates(page)).length).toBe(0);

    await page.keyboard.press("Control+Z");
    await expect(page.locator(".state-template-card")).toHaveCount(1);
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Preset: Updated reusable login");
    await expect.poll(async () => (await savedStateTemplates(page))[0]?.title).toBe("Updated reusable login");

    await page.keyboard.press("Control+Y");
    await expect(page.locator(".state-template-card")).toHaveCount(0);
    await expect.poll(async () => (await savedStateTemplates(page)).length).toBe(0);
  });

  test("reuses state explorer presets as stable snapshots across reload, drag, and double click", async ({ page }) => {
    await openTool(page);
    const login = page.locator('[data-id="login"]');

    await login.click();
    await page.locator("#pTitle").fill("Reusable login");
    await componentEditor(page, "Text").locator("textarea").fill("Welcome {{role}}");
    await page.locator("#pData").fill('{"role":"member"}');
    await dragNodeToStateExplorer(page, login);
    await expect(page.locator(".state-template-card").filter({ hasText: "Reusable login" })).toBeVisible();
    await expect.poll(async () => (await savedStateTemplates(page)).length).toBe(1);

    const workPage = await page.context().newPage();
    await workPage.goto("/state.html");
    await expect(workPage.locator('[data-id="login"]')).toBeVisible();
    const template = workPage.locator(".state-template-card").filter({ hasText: "Reusable login" });
    await expect(template).toBeVisible();

    const mapBox = await visibleBox(workPage.locator("#map"));
    await template.dragTo(workPage.locator("#map"), {
      targetPosition: { x: Math.round(mapBox.width * 0.56), y: 120 }
    });
    await expect(workPage.locator(".node")).toHaveCount(7);
    await expect(workPage.locator("#stateInspectorTitle")).toHaveText("Reusable login");
    await expect(workPage.locator("#pTitle")).toHaveValue("Reusable login");
    await expect(componentEditor(workPage, "Text").locator("textarea")).toHaveValue("Welcome {{role}}");
    await expect(workPage.locator("#pData")).toHaveValue(/"role": "member"/);
    await expect(appFrame(workPage).getByText("Welcome member")).toBeVisible();

    const createdId = await workPage.locator(".node.selected").getAttribute("data-id");
    await componentEditor(workPage, "Text").locator("textarea").fill("Edited instance only");
    await expect.poll(async () => {
      const templates = await savedStateTemplates(workPage);
      return templates[0].components.find(component => component.type === "text")?.text;
    }).toBe("Welcome {{role}}");

    await template.dblclick();
    await expect(workPage.locator(".node")).toHaveCount(8);
    await expect(componentEditor(workPage, "Text").locator("textarea")).toHaveValue("Welcome {{role}}");

    await expect.poll(async () => {
      const model = await savedModel(workPage);
      const reusableStates = model.states.filter(state => state.title === "Reusable login");
      return {
        count: reusableStates.length,
        editedText: model.states.find(state => state.id === createdId)?.components.find(component => component.type === "text")?.text,
        snapshotTexts: reusableStates
          .map(state => state.components.find(component => component.type === "text")?.text)
          .sort()
      };
    }).toEqual({
      count: 3,
      editedText: "Edited instance only",
      snapshotTexts: ["Edited instance only", "Welcome {{role}}", "Welcome {{role}}"]
    });
    await workPage.close();
  });

  test("drag-drops built-in explorer presets onto the canvas @smoke", async ({ page }) => {
    await openTool(page);

    const before = await page.locator(".node").count();
    const mapBox = await visibleBox(page.locator("#map"));
    await componentPreset(page, "Text").dragTo(page.locator("#map"), {
      targetPosition: { x: Math.round(mapBox.width * 0.58), y: 170 }
    });

    await expect(page.locator(".node")).toHaveCount(before + 1);
    await expect(page.locator("#pTitle")).toHaveValue("Text");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.filter(state => state.title === "Text").length;
    }).toBeGreaterThan(0);
  });

  test("keeps data-wire render controls from overlapping in the state editor @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Render layout",
      initial: "state_3",
      states: [{
        id: "state_3",
        title: "State 3",
        body: "",
        x: 220,
        y: 220,
        components: [],
        subscriptions: ["catalog.item"],
        dataWires: [
          { id: "wire_image", sourcePath: "catalog.item.image", role: "image", componentType: "image", label: "Image" },
          { id: "wire_title", sourcePath: "catalog.item.title", role: "title", componentType: "heading", label: "Title" },
          { id: "wire_price", sourcePath: "catalog.item.price", role: "price", componentType: "text", label: "Price" },
          { id: "wire_description", sourcePath: "catalog.item.description", role: "description", componentType: "text", label: "Description" },
          { id: "wire_category", sourcePath: "catalog.item.category", role: "field", componentType: "text", label: "Category" }
        ]
      }],
      transitions: []
    };
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(`${key}.editor`, JSON.stringify({ model }));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await openStateInspector(page, "state_3");
    await expect.poll(async () => {
      const stored = await savedModel(page);
      return stored.states.find(state => state.id === "state_3")?.dataWires?.length || 0;
    }).toBe(5);

    const rows = dataRenderRows(page);
    await expect(rows).toHaveCount(5);
    await expect(rows.first().locator(".data-wire-controls")).toBeVisible();

    const report = await rows.evaluateAll(rowEls => {
      const rectOf = el => {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
      };
      const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const pairReport = elements => {
        const rects = elements.map(el => ({ selector: el.className || el.tagName, rect: rectOf(el) }));
        const overlaps = [];
        for (let i = 0; i < rects.length; i += 1) {
          for (let j = i + 1; j < rects.length; j += 1) {
            const area = overlap(rects[i].rect, rects[j].rect);
            if (area > 1) overlaps.push({ a: rects[i].selector, b: rects[j].selector, area });
          }
        }
        return overlaps;
      };
      return rowEls.map(row => {
        const rowRect = rectOf(row);
        const directChildren = [...row.children];
        const controls = row.querySelector(".data-wire-controls");
        const controlChildren = controls ? [...controls.children] : [];
        const allChildren = [...row.querySelectorAll(".component-editor-head, .field, .data-wire-controls, select, button")];
        return {
          childOverlaps: pairReport(directChildren),
          controlOverlaps: pairReport(controlChildren),
          outside: allChildren
            .map(el => ({ selector: el.className || el.tagName, rect: rectOf(el) }))
            .filter(item => item.rect.left < rowRect.left - 1 || item.rect.right > rowRect.right + 1 || item.rect.top < rowRect.top - 1 || item.rect.bottom > rowRect.bottom + 1)
        };
      });
    });

    for (const row of report) {
      expect(row.childOverlaps).toEqual([]);
      expect(row.controlOverlaps).toEqual([]);
      expect(row.outside).toEqual([]);
    }
  });

  test("does not rehydrate deleted fetch render mappings from repeat defaults @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "No automap",
      initial: "state_3",
      states: [{
        id: "state_3",
        title: "State 3",
        body: "",
        x: 220,
        y: 220,
        components: [],
        data: {
          fetch: {
            data: [{
              image: "https://example.com/product.png",
              title: "Ada Chair",
              price: 42,
              description: "Compact and sturdy"
            }]
          }
        },
        dataSource: { url: "https://example.com/products.json", target: "fetch", select: "" },
        repeat: { path: "fetch.data", as: "item", index: "i" },
        subscriptions: ["fetch.data"],
        dataWires: []
      }],
      transitions: []
    };
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(`${key}.editor`, JSON.stringify({ model }));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await openStateInspector(page, "state_3");

    await expect(dataRenderRows(page)).toHaveCount(0);
    await expect(page.locator("#pDataWireList .data-wire-row")).toHaveCount(0);
    await expect.poll(async () => {
      const stored = await savedModel(page);
      return stored.states.find(state => state.id === "state_3")?.dataWires?.length || 0;
    }).toBe(0);

    await page.locator("#pTitle").fill("Still empty");
    await expect.poll(async () => {
      const stored = await savedModel(page);
      return stored.states.find(state => state.id === "state_3")?.dataWires?.length || 0;
    }).toBe(0);
  });

  test("keeps data-wire paths and render order editable from both state editor lists @smoke", async ({ page }) => {
    const imageUrl = "https://example.com/original.png";
    const altImageUrl = "https://example.com/alt.png";
    const model = {
      version: 2,
      name: "Render mapping editor",
      initial: "state_3",
      states: [{
        id: "state_3",
        title: "State 3",
        body: "",
        x: 220,
        y: 220,
        data: {
          catalog: {
            item: {
              image: imageUrl,
              altImage: altImageUrl,
              images: [{ url: "https://example.com/from-array.png" }],
              title: "Ada Chair",
              price: "$42",
              description: "Compact and sturdy",
              category: "Furniture",
              badge: "New"
            }
          }
        },
        subscriptions: ["catalog.item"],
        dataWires: [
          { id: "wire_image", sourcePath: "catalog.item.image", role: "image", componentType: "image", label: "Image" },
          { id: "wire_title", sourcePath: "catalog.item.title", role: "title", componentType: "heading", label: "Title" },
          { id: "wire_price", sourcePath: "catalog.item.price", role: "price", componentType: "text", label: "Price" },
          { id: "wire_description", sourcePath: "catalog.item.description", role: "description", componentType: "text", label: "Description" },
          { id: "wire_category", sourcePath: "catalog.item.category", role: "field", componentType: "text", label: "Category" }
        ]
      }],
      transitions: []
    };
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(`${key}.editor`, JSON.stringify({ model }));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await openStateInspector(page, "state_3");

    await expect(appFrame(page).locator(".component-image")).toHaveAttribute("src", imageUrl);
    const addRenderSelect = page.locator('.data-wire-render-panel select[aria-label="Add render path"]');
    await expect(addRenderSelect.locator('option[value="catalog.item.badge"]')).toHaveCount(1);
    await addRenderSelect.selectOption("catalog.item.badge");
    await page.locator(".data-wire-render-panel").getByRole("button", { name: "+ Add render" }).click();
    await expect.poll(async () => {
      const stored = await savedModel(page);
      return stored.states.find(state => state.id === "state_3").dataWires.map(wire => wire.sourcePath);
    }).toContain("catalog.item.badge");

    const renderRows = dataRenderRows(page);
    await expect(renderRows).toHaveCount(6);
    const renderPathSelect = renderRows.first().locator('select[aria-label="Source path"]');
    await expect(renderPathSelect.locator('option[value="catalog.item.images.0.url"]')).toHaveCount(1);
    await renderPathSelect.selectOption("catalog.item.altImage");
    await expect(appFrame(page).locator(".component-image")).toHaveAttribute("src", altImageUrl);
    await expect.poll(async () => {
      const stored = await savedModel(page);
      const state = stored.states.find(item => item.id === "state_3");
      return state.dataWires.find(wire => wire.id === "wire_image")?.sourcePath;
    }).toBe("catalog.item.altImage");

    await page.locator("#pDataCard").evaluate(el => { el.open = true; });
    const stateRows = page.locator("#pDataWireList .data-wire-row");
    await expect(stateRows).toHaveCount(6);
    let dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    let targetBox = await visibleBox(stateRows.nth(2));
    await stateRows.first().dispatchEvent("dragstart", { dataTransfer, bubbles: true, cancelable: true });
    await stateRows.nth(2).dispatchEvent("dragover", {
      dataTransfer,
      bubbles: true,
      cancelable: true,
      clientY: targetBox.y + targetBox.height - 4
    });
    await stateRows.nth(2).dispatchEvent("drop", {
      dataTransfer,
      bubbles: true,
      cancelable: true,
      clientY: targetBox.y + targetBox.height - 4
    });
    await expect.poll(async () => {
      const stored = await savedModel(page);
      return stored.states.find(state => state.id === "state_3").dataWires.map(wire => wire.sourcePath);
    }).toEqual(["catalog.item.title", "catalog.item.price", "catalog.item.altImage", "catalog.item.description", "catalog.item.category", "catalog.item.badge"]);

    dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    const refreshedRenderRows = dataRenderRows(page);
    targetBox = await visibleBox(refreshedRenderRows.nth(5));
    await refreshedRenderRows.first().locator(".component-drag-handle").dispatchEvent("dragstart", { dataTransfer, bubbles: true, cancelable: true });
    await refreshedRenderRows.nth(5).dispatchEvent("dragover", {
      dataTransfer,
      bubbles: true,
      cancelable: true,
      clientY: targetBox.y + targetBox.height - 4
    });
    await refreshedRenderRows.nth(5).dispatchEvent("drop", {
      dataTransfer,
      bubbles: true,
      cancelable: true,
      clientY: targetBox.y + targetBox.height - 4
    });
    await expect.poll(async () => {
      const stored = await savedModel(page);
      return stored.states.find(state => state.id === "state_3").dataWires.map(wire => wire.sourcePath);
    }).toEqual(["catalog.item.price", "catalog.item.altImage", "catalog.item.description", "catalog.item.category", "catalog.item.badge", "catalog.item.title"]);
  });

  test("keeps visible ports in a single svg coordinate system @smoke", async ({ page }) => {
    await openTool(page);

    await expect(page.locator(".node > .input-port, .node > .port, .port-slot")).toHaveCount(0);
    await expect.poll(async () => page.locator("svg#ports .svg-port").count()).toBeGreaterThan(0);
    await expect(page.locator("svg#ports .edge-pin").first()).toBeVisible();

    const report = await page.evaluate(() => {
      const nums = value => (value.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      const pathPoints = value => {
        const values = nums(value);
        const points = [];
        for (let i = 0; i < values.length; i += 2) points.push({ x: values[i], y: values[i + 1] });
        return points;
      };
      return [...document.querySelectorAll(".edge[data-edge-id]")].map(edge => {
        const points = pathPoints(edge.getAttribute("d") || "");
        const pins = [...document.querySelectorAll('.edge-pin[data-edge-id="' + CSS.escape(edge.dataset.edgeId) + '"]')].map(pin => ({
          side: pin.dataset.edgePin,
          x: Number(pin.getAttribute("cx")),
          y: Number(pin.getAttribute("cy"))
        }));
        return { id: edge.dataset.edgeId, points, pins };
      });
    });

    expect(report.length).toBeGreaterThan(0);
    for (const edge of report) {
      const start = edge.points[0];
      const end = edge.points[edge.points.length - 1];
      const outPin = edge.pins.find(pin => pin.side === "out");
      const inPin = edge.pins.find(pin => pin.side === "in");
      expect(outPin).toMatchObject(start);
      expect(inPin).toMatchObject(end);
      for (let index = 1; index < edge.points.length; index += 1) {
        const previous = edge.points[index - 1];
        const point = edge.points[index];
        expect(previous.x === point.x || previous.y === point.y).toBe(true);
      }
    }
  });

  test("exports individual state components, presets, and full definitions with presets", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
    const stateDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export component" }).click();
    const stateExport = JSON.parse(fs.readFileSync(await (await stateDownload).path(), "utf8"));
    expect(stateExport.kind).toBe("state-blueprint-component");
    expect(stateExport.component.type).toBe("state");
    expect(stateExport.component.state.id).toBe("login");
    expect(stateExport.component.state.title).toBe("Login");

    await addComponentState(page, "Note");
    await page.locator("#pTitle").fill("Portable component");
    await componentEditor(page, "Note").locator("textarea").fill("Reusable note");
    const portableId = await page.locator(".node.selected").getAttribute("data-id");
    await dragNodeToStateExplorer(page, page.locator(`[data-id="${portableId}"]`));

    const presetDownload = page.waitForEvent("download");
    await page.locator("#pTemplateExport").click();
    const presetExport = JSON.parse(fs.readFileSync(await (await presetDownload).path(), "utf8"));
    expect(presetExport.kind).toBe("state-blueprint-component");
    expect(presetExport.component.type).toBe("preset");
    expect(presetExport.component.template.title).toBe("Portable component");
    expect(presetExport.component.template.body).toBe("");
    expect(presetExport.component.template.components[0].text).toBe("Reusable note");

    const definitionDownload = page.waitForEvent("download");
    await page.keyboard.press("Control+S");
    const definition = JSON.parse(fs.readFileSync(await (await definitionDownload).path(), "utf8"));
    expect(definition.kind).toBe("state-blueprint-definition");
    expect(definition.stateTemplates).toHaveLength(1);
    expect(definition.stateTemplates[0].title).toBe("Portable component");
    expect(definition.stateTemplates[0].body).toBe("");
    expect(definition.stateTemplates[0].components[0].text).toBe("Reusable note");
  });

  test("imports state components and presets without losing render mappings @smoke", async ({ page }) => {
    await openTool(page);

    const stateComponent = {
      kind: "state-blueprint-component",
      schemaVersion: 1,
      app: "State Blueprint",
      exportedAt: "2026-06-23T00:00:00.000Z",
      component: {
        type: "state",
        state: {
          id: "portable_state",
          title: "Portable State",
          body: "",
          components: [{ id: "portable_text", type: "text", text: "Portable text", url: "" }],
          data: {},
          dataSource: { url: "", target: "fetch", select: "", timeoutMs: 8000, retries: 2 },
          repeat: { path: "", as: "item", index: "i" },
          dataWires: [],
          subscriptions: [],
          boundary: { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false },
          x: 120,
          y: 160
        }
      }
    };

    await openStateInspector(page, "login");
    await page.locator("#pImportState").scrollIntoViewIfNeeded();
    let chooser = page.waitForEvent("filechooser");
    await page.locator("#pImportState").click();
    await (await chooser).setFiles({
      name: "portable-state.state-component.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(stateComponent))
    });
    await expect(nodeByTitle(page, "Portable State")).toBeVisible();
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.some(state => state.title === "Portable State");
    }).toBe(true);

    const presetComponent = {
      kind: "state-blueprint-component",
      schemaVersion: 1,
      app: "State Blueprint",
      exportedAt: "2026-06-23T00:00:00.000Z",
      component: {
        type: "preset",
        template: {
          id: "portable_fetch",
          rootStateId: "portable_fetch",
          title: "Portable Fetch",
          body: "",
          components: [
            { id: "slot_title", type: "dataWire", wireId: "wire_title", text: "", url: "" },
            {
              id: "portable_list",
              type: "list",
              text: "First\nDocs",
              url: "",
              items: [
                { id: "li_first", type: "text", text: "First", url: "" },
                { id: "li_docs", type: "link", text: "Docs", url: "https://example.com/docs" }
              ]
            }
          ],
          data: {},
          dataSource: { url: "", target: "fetch", select: "", timeoutMs: 8000, retries: 2 },
          repeat: { path: "fetch.data", as: "item", index: "i" },
          dataWires: [
            { id: "wire_title", sourcePath: "fetch.data.title", scopePath: "fetch.data", itemPath: "title", role: "title", componentType: "heading", label: "Title" }
          ],
          subscriptions: ["fetch.data.title"],
          boundary: { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false },
          states: [],
          transitions: []
        }
      }
    };

    await page.locator("#pImportState").scrollIntoViewIfNeeded();
    chooser = page.waitForEvent("filechooser");
    await page.locator("#pImportState").click();
    await (await chooser).setFiles({
      name: "portable-fetch.state-component.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(presetComponent))
    });
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Preset: Portable Fetch");
    await expect.poll(async () => {
      const templates = await savedStateTemplates(page);
      const imported = templates.find(template => template.title === "Portable Fetch");
      const portableList = imported?.components?.find(component => component.id === "portable_list");
      return {
        dataWire: imported?.dataWires?.[0]?.sourcePath || "",
        subscription: imported?.subscriptions?.[0] || "",
        boundary: imported?.boundary?.entryDisabled,
        renderWire: imported?.components?.find(component => component.type === "dataWire")?.wireId || "",
        listItemTypes: portableList?.items?.map(item => item.type) || []
      };
    }).toEqual({
      dataWire: "fetch.data.title",
      subscription: "fetch.data.title",
      boundary: false,
      renderWire: "wire_title",
      listItemTypes: ["text", "link"]
    });

    await page.locator("#pTemplateUse").click();
    await expect(nodeByTitle(page, "Portable Fetch")).toBeVisible();
    await expect.poll(async () => {
      const model = await savedModel(page);
      const imported = model.states.find(state => state.title === "Portable Fetch");
      const portableList = imported?.components?.find(component => component.type === "list");
      return {
        dataWire: imported?.dataWires?.[0]?.sourcePath || "",
        renderWire: imported?.components?.find(component => component.type === "dataWire")?.wireId || "",
        listItemTypes: portableList?.items?.map(item => item.type) || []
      };
    }).toEqual({
      dataWire: "fetch.data.title",
      renderWire: "wire_title",
      listItemTypes: ["text", "link"]
    });
  });

  test("reorders component rows with the editor drag handle @smoke", async ({ page }) => {
    await openTool(page);
    await page.evaluate(() => {
      const state = model.states.find(item => item.id === "login");
      state.components = [
        { id: "component_heading", type: "heading", text: "Heading", url: "" },
        { id: "component_text", type: "text", text: "Text", url: "" },
        { id: "component_note", type: "note", text: "Note", url: "" }
      ];
      saveModel("test:component-order");
      draw();
    });
    await openStateInspector(page, "login");

    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    const targetBox = await visibleBox(componentEditor(page, "Note"));
    await componentEditor(page, "Heading").locator(".component-drag-handle").dispatchEvent("dragstart", {
      dataTransfer,
      bubbles: true,
      cancelable: true
    });
    await componentEditor(page, "Note").dispatchEvent("dragover", {
      dataTransfer,
      bubbles: true,
      cancelable: true,
      clientY: targetBox.y + targetBox.height - 4
    });
    await componentEditor(page, "Note").dispatchEvent("drop", {
      dataTransfer,
      bubbles: true,
      cancelable: true,
      clientY: targetBox.y + targetBox.height - 4
    });

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login").components
        .filter(component => component.type !== "transitionButton")
        .map(component => component.id);
    }).toEqual(["component_text", "component_note", "component_heading"]);
  });

  test("shows outgoing transition buttons in the render editor without mutating components @smoke", async ({ page }) => {
    await openTool(page);
    await openStateInspector(page, "auth_start");

    await expect(componentEditor(page, "Text")).toBeVisible();
    await expect(componentEditor(page, "Button: Login")).toBeVisible();
    await expect(componentEditor(page, "Button: Registrieren")).toBeVisible();

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "auth_start").components.map(component => component.type);
    }).toEqual(["text"]);
  });

  test("persists dragged transition buttons as render items and renders them in order @smoke", async ({ page }) => {
    await openTool(page);
    await openStateInspector(page, "auth_start");

    await dragComponentEditorBefore(page, "Button: Login", "Text");

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "auth_start").components.map(component =>
        component.type === "transitionButton" ? component.transitionId : component.type
      );
    }).toEqual(["t_auth_login", "text", "t_auth_register"]);

    await expect.poll(async () => appFrame(page).locator("#screen").evaluate(screen => {
      const stack = screen.querySelector(".component-stack");
      return [...(stack?.children || [])].map(child =>
        child.querySelector("button[data-transition-id]")?.dataset.transitionId || child.textContent.trim()
      );
    })).toEqual(["t_auth_login", "User chooses login or registration.", "t_auth_register"]);
  });

  test("persists data-wire render rows between components and transition buttons @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Mixed render order",
      initial: "state_3",
      states: [
        {
          id: "state_3",
          title: "State 3",
          body: "",
          x: 220,
          y: 220,
          components: [{ id: "manual_note", type: "note", text: "Manual note", url: "" }],
          data: { catalog: { item: { title: "Ada Chair" } } },
          subscriptions: ["catalog.item"],
          dataWires: [
            { id: "wire_title", sourcePath: "catalog.item.title", role: "title", componentType: "heading", label: "Title" }
          ]
        },
        {
          id: "state_done",
          title: "Done",
          body: "",
          x: 520,
          y: 220,
          components: []
        }
      ],
      transitions: [
        { id: "t_next", from: "state_3", to: "state_done", label: "Continue", condition: "", set: {} }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(`${key}.editor`, JSON.stringify({ model }));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await openStateInspector(page, "state_3");

    await expect(componentEditor(page, "Data: Title")).toBeVisible();
    await expect(componentEditor(page, "Note")).toBeVisible();
    await expect(componentEditor(page, "Button: Continue")).toBeVisible();

    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    const noteBox = await visibleBox(componentEditor(page, "Note"));
    await componentEditor(page, "Data: Title").locator(".component-drag-handle").dispatchEvent("dragstart", {
      dataTransfer,
      bubbles: true,
      cancelable: true
    });
    await componentEditor(page, "Note").dispatchEvent("dragover", {
      dataTransfer,
      bubbles: true,
      cancelable: true,
      clientY: noteBox.y + noteBox.height - 4
    });
    await componentEditor(page, "Note").dispatchEvent("drop", {
      dataTransfer,
      bubbles: true,
      cancelable: true,
      clientY: noteBox.y + noteBox.height - 4
    });

    await expect.poll(async () => {
      const stored = await savedModel(page);
      return stored.states.find(state => state.id === "state_3").components.map(component =>
        component.type === "dataWire" ? component.wireId :
          component.type === "transitionButton" ? component.transitionId :
            component.id
      );
    }).toEqual(["manual_note", "wire_title", "t_next"]);

    await expect.poll(async () => appFrame(page).locator("#screen").evaluate(screen => {
      const stack = screen.querySelector(".component-stack");
      return [...(stack?.children || [])].map(child =>
        child.querySelector("button[data-transition-id]")?.dataset.transitionId || child.textContent.trim()
      );
    })).toEqual(["Manual note", "Ada Chair", "t_next"]);
  });

  test("keeps preview controls inside the viewport when opened, collapsed, and narrow", async ({ page }) => {
    await openTool(page);

    await assertVisibleInViewport(page, "#btnOpen");
    await assertVisibleInViewport(page, "#btnTogglePreview");

    await page.locator("#btnTogglePreview").click();
    await assertVisibleInViewport(page, "#btnOpen");
    await assertVisibleInViewport(page, "#btnTogglePreview");

    await page.setViewportSize({ width: 900, height: 760 });
    await page.locator("#btnTogglePreview").click();
    await assertVisibleInViewport(page, "#btnOpen");
    await assertVisibleInViewport(page, "#btnTogglePreview");
  });

  test("hides the topbar scrollbar on narrow screens", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await openTool(page);

    const topbar = await page.locator(".topbar").evaluate(el => {
      const style = getComputedStyle(el);
      return {
        overflowX: style.overflowX,
        scrollbarWidth: style.scrollbarWidth
      };
    });
    expect(topbar.overflowX).toBe("auto");
    expect(topbar.scrollbarWidth).toBe("none");
  });

  test("keeps the canvas free of helper and zoom overlays around the state explorer", async ({ page }) => {
    await openTool(page);

    await expect(page.locator(".help")).toHaveCount(0);
    await expect(page.locator(".zoom-controls")).toHaveCount(0);
    await expect(page.locator(".state-explorer-label")).toHaveCount(0);
    await expect(page.locator('.state-explorer-section[data-template-group="core"]')).toBeVisible();
    await expect(page.locator('.state-explorer-section[data-template-group="user"]')).toBeVisible();
    await expect(componentPreset(page, "Text").getByRole("button", { name: "Delete" })).toHaveCount(0);
    await assertVisibleInViewport(page, "#stateExplorer");
    await assertVisibleInViewport(page, "#btnToggleStateExplorer");
    await expect(page.locator("#stateExplorerList")).toHaveCSS("scrollbar-color", "rgb(49, 95, 140) rgb(7, 19, 33)");
    await expect(page.locator("#stateExplorerList")).toHaveCSS("scrollbar-width", "thin");

    await page.locator("#btnToggleStateExplorer").click();
    await expect(page.locator("#stateExplorer")).toHaveClass(/collapsed/);
    await assertVisibleInViewport(page, "#stateExplorer");
    await assertVisibleInViewport(page, "#btnToggleStateExplorer");
  });

  test("downloads formal definitions and self-contained HTML exports", async ({ page }) => {
    await openTool(page);

    const saveDownload = page.waitForEvent("download");
    await page.keyboard.press("Control+S");
    const definitionDownload = await saveDownload;
    const definitionPath = await definitionDownload.path();
    const definition = JSON.parse(fs.readFileSync(definitionPath, "utf8"));

    expect(definition.kind).toBe("state-blueprint-definition");
    expect(definition.schemaVersion).toBe(2);
    expect(definition.model.states).toHaveLength(6);
    expect(definition.model.transitions.length).toBeGreaterThan(0);

    const exportDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export HTML" }).click();
    const htmlDownload = await exportDownload;
    const htmlPath = await htmlDownload.path();
    const html = fs.readFileSync(htmlPath, "utf8");

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("const IS_STANDALONE_EXPORT = true");
    expect(html).toContain("Standard Auth Flow");
    expect(html).toContain("color-scheme: dark");
    expect(html).toContain("--bg: #020617");
    expect(html).toContain("--primary: #38bdf8");
    expect(html).toContain("Atkinson Hyperlegible");
    expect(html).not.toContain("--card: #ffffff");
    expect(html).not.toContain("background: white");
    expect(html).not.toContain("speechRate");
    expect(html).not.toContain("Vorlesen");
    expect(html).not.toContain("SpeechSynthesis");
  });

  test("downloads a valid formal definition from a blank canvas @smoke", async ({ page }) => {
    await page.addInitScript(key => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
    }, STORAGE_KEY);
    await page.goto("/state.html");
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(0);

    const saveDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save" }).click();
    const definition = JSON.parse(fs.readFileSync(await (await saveDownload).path(), "utf8"));
    expect(definition.kind).toBe("state-blueprint-definition");
    expect(definition.model.initial).toBe("");
    expect(definition.model.states).toEqual([]);
    expect(definition.model.transitions).toEqual([]);
  });
});
