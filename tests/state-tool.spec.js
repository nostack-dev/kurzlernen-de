const fs = require("node:fs");
const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "stateBlueprintHotLinked.model.v2";

async function openTool(page) {
  await page.addInitScript(key => {
    for (const name of [key, `${key}.camera`, `${key}.previewCollapsed`]) {
      localStorage.removeItem(name);
    }
  }, STORAGE_KEY);
  await page.goto("/state.html");
  await expect(page.locator('[data-id="auth_start"]')).toBeVisible();
  await expect(page.locator(".node")).toHaveCount(6);
  await expect(appFrame(page).locator("#statePill")).toHaveText("auth_start");
}

function appFrame(page) {
  return page.frameLocator("#appFrame");
}

async function centerOf(locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) {
    const rect = await locator.evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    });
    if (!rect.width || !rect.height) throw new Error("Expected visible element with a bounding box");
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2
    };
  }
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

async function savedModel(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
}

function componentEditor(page, title) {
  return page.locator(".component-editor").filter({
    has: page.locator(".component-editor-head span").filter({ hasText: new RegExp(`^${title}$`) })
  });
}

async function worldTransform(page) {
  return page.locator("#world").evaluate(el => getComputedStyle(el).transform);
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
    const popover = document.querySelector("#popover");
    const popoverRect = popover && !popover.hidden ? popover.getBoundingClientRect() : null;
    for (let y = rect.top + 100; y < rect.top + rect.height - 120; y += 38) {
      for (let x = rect.left + 80; x < rect.left + rect.width - 80; x += 46) {
        if (popoverRect &&
          x >= popoverRect.left - 36 &&
          x <= popoverRect.right + 36 &&
          y >= popoverRect.top - 36 &&
          y <= popoverRect.bottom + 36) continue;
        const el = document.elementFromPoint(x, y);
        if (!el || !map.contains(el)) continue;
        if (el.closest(".popover, .node, .edge, .hit, .edge-label, .edge-tip-hit, .zoom-controls, .help, .selection-actions")) continue;
        return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("Could not find an empty canvas point");
  return point;
}

test.describe("State Blueprint tool", () => {
  test("creates a complete state machine from the UI with data, templates, conditions, sets, preview, and export", async ({ page }) => {
    await openTool(page);
    await page.getByRole("button", { name: "New" }).click();
    await page.getByRole("button", { name: "Neu starten" }).click();

    await expect(page.locator(".node")).toHaveCount(1);
    await expect(page.locator('[data-id="start"]')).toBeVisible();

    await page.locator('[data-id="start"]').dblclick();
    await page.locator("#pTitle").fill("Collect details");
    await page.locator("#pBody").fill("Tell us who should receive the short lesson.");
    await page.locator("#pData").fill('{"userName":"Ada","profile":{"tier":"starter"}}');

    await page.getByRole("button", { name: "+ Heading" }).click();
    await componentEditor(page, "Heading").locator("input").fill("Welcome {{userName}}");
    await page.getByRole("button", { name: "+ Text" }).click();
    await componentEditor(page, "Text").locator("textarea").fill("Tier: {{profile.tier}}");
    await page.getByRole("button", { name: "+ List" }).click();
    const listInputs = componentEditor(page, "List").locator(".list-item-editor input");
    await listInputs.nth(0).fill("Confirm email");
    await listInputs.nth(1).fill("Accept terms");
    await page.getByRole("button", { name: "+ Link" }).click();
    await componentEditor(page, "Link").locator("input").nth(0).fill("Example docs for {{userName}}");
    await componentEditor(page, "Link").locator("input").nth(1).fill("https://example.com/docs");
    await page.getByRole("button", { name: "+ Note" }).click();
    await componentEditor(page, "Note").locator("textarea").fill("Stored from state.data: {{userName}}");
    await page.keyboard.press("Escape");
    await expect(page.locator("#popover")).toBeHidden();

    const startPort = await centerOf(page.locator('[data-id="start"] .port'));
    const map = await page.locator("#map").boundingBox();
    await page.mouse.move(startPort.x, startPort.y);
    await page.mouse.down();
    await page.mouse.move(map.x + 430, map.y + 230, { steps: 12 });
    await page.mouse.up();

    await expect(page.locator(".node")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await page.locator("svg text.edge-label").filter({ hasText: "Next" }).click();
    await page.locator("#pLabel").fill("Submit");
    await page.locator("#pCond").fill('email == "ada@example.com" && accepted_terms');
    await page.locator("#pSet").fill('{"userName":"Grace","role":"member"}');

    const createdStateId = await page.evaluate(key => {
      const model = JSON.parse(localStorage.getItem(key));
      return model.states.find(state => state.id !== "start").id;
    }, STORAGE_KEY);

    await page.locator(`[data-id="${createdStateId}"]`).dblclick();
    await page.locator("#pTitle").fill("Lesson ready");
    await page.locator("#pBody").fill("The generated state reads transition data.");
    await page.getByRole("button", { name: "+ Note" }).click();
    await componentEditor(page, "Note").locator("textarea").fill("Ready for {{userName}} as {{role}}");
    await page.keyboard.press("Escape");
    await expect(page.locator("#popover")).toBeHidden();

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
    expect(start.components.map(component => component.type)).toEqual(["heading", "text", "list", "link", "note"]);
    expect(done.components[0].text).toBe("Ready for {{userName}} as {{role}}");
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
      for (const name of [key, `${key}.camera`, `${key}.previewCollapsed`]) {
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

  test("keeps invalid data and transition set JSON out of the saved model", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').dblclick();
    await page.locator("#pData").fill('{"userName":"Ada"}');
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

    await page.locator('[data-id="login"]').dblclick();
    await page.locator("#pData").fill('{"userName":"Ada"}');
    await page.getByRole("button", { name: "+ Note" }).click();
    await componentEditor(page, "Note").locator("textarea").fill("Manual note for {{userName}}");

    await expect.poll(async () => {
      const model = await savedModel(page);
      const login = model.states.find(state => state.id === "login");
      return login.components.find(component => component.type === "note")?.text || "";
    }).toBe("Manual note for {{userName}}");

    await page.keyboard.press("Escape");
    await page.locator('[data-id="login"]').click();
    await expect(appFrame(page).getByText("Manual note for Ada")).toBeVisible();
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
    await page.getByRole("button", { name: "+ Note" }).click();
    await componentEditor(page, "Note").locator("textarea").fill("Helper: {{helperText}}");

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

  test("opens and applies state edits via double click and gear", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').dblclick();
    await expect(page.locator("#popover")).toBeVisible();
    await expect(page.locator("#pTitle")).toHaveValue("Login");
    await expect(page.locator("#pTitle")).toHaveAttribute("tabindex", "0");
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await page.locator("#pTitle").fill("Sign in");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in");

    await page.evaluate(key => {
      for (const name of [key, `${key}.camera`, `${key}.previewCollapsed`]) {
        localStorage.removeItem(name);
      }
    }, STORAGE_KEY);
    await page.reload();
    await expect(page.locator('[data-id="register"]')).toBeVisible();
    await page.locator('[data-id="register"] .node-edit').click();
    await expect(page.locator("#pTitle")).toHaveValue("Register");
  });

  test("uses tool undo and redo even when an editor input is focused", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').dblclick();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await page.locator("#pTitle").fill("Sign in");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in");
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Control+KeyZ");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Login");
    await expect(page.locator("#popover")).toBeHidden();

    await page.keyboard.press("Control+KeyY");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in");
  });

  test("keeps state editor focus and tab order predictable", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').dblclick();
    await expect(page.locator("#pTitle")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pBody")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pData")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pAddHeading")).toHaveAttribute("tabindex", "0");
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pBody").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pData").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pAddHeading").evaluate(el => document.activeElement === el)).toBe(true);
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

  test("focuses first runtime input, preserves default tab order, and submits positive action with Enter", async ({ page }) => {
    await openTool(page);
    const app = appFrame(page);

    await page.locator('[data-id="login"]').click();
    await expect(app.locator("#statePill")).toHaveText("login");

    const email = app.locator(".field").filter({ hasText: "email" }).locator("input");
    const password = app.locator(".field").filter({ hasText: "password" }).locator("input");
    const primaryButton = app.getByRole("button", { name: "Einloggen" });

    await expect.poll(() => email.evaluate(el => document.activeElement === el)).toBe(true);
    await expect(email).toHaveAttribute("tabindex", "0");
    await expect(password).toHaveAttribute("tabindex", "0");
    await expect(primaryButton).toHaveAttribute("tabindex", "0");
    await expect(primaryButton).toHaveAttribute("data-default-action", "true");

    await email.fill("user@example.com");
    await password.fill("secret123");
    await password.press("Enter");

    await expect(app.locator("#statePill")).toHaveText("logged_in");
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
    const model = await savedModel(page);
    expect(model.states).toHaveLength(7);
    expect(model.transitions.some(t => t.from === "auth_start" && /^state_\d+$/.test(t.to))).toBeTruthy();
  });

  test("reroutes an existing transition from the arrowhead with Alt-drag", async ({ page }) => {
    await openTool(page);
    const loginEdgeId = await page.evaluate(key => {
      const model = JSON.parse(localStorage.getItem(key));
      return model.transitions.find(t => t.from === "auth_start" && t.label === "Login").id;
    }, STORAGE_KEY);
    const arrowTip = page.locator(`circle.edge-tip-hit[data-edge-id="${loginEdgeId}"]`);
    await expect(arrowTip).toBeVisible();
    const start = await centerOf(arrowTip);
    const end = await centerOf(page.locator('[data-id="register"] .input-port'));

    await page.keyboard.down("Alt");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up("Alt");

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.transitions.find(t => t.from === "auth_start" && t.label === "Login")?.to;
    }).toBe("register");
    await expect(page.locator("#popover")).toBeHidden();
  });

  test("closes edit popovers on outside click", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').dblclick();
    await expect(page.locator("#pTitle")).toBeVisible();
    let point = await emptyCanvasPoint(page);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator("#popover")).toBeHidden();

    const label = page.locator("svg text.edge-label").filter({ hasText: "Login" });
    await expect(label).toHaveCount(1);
    await label.click();
    await expect(page.locator("#pLabel")).toBeVisible();
    point = await emptyCanvasPoint(page);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator("#popover")).toBeHidden();
  });

  test("closes focused state edit popover with Escape", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').dblclick();
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(page.locator("#popover")).toBeHidden();
  });

  test("closes state popover on empty-canvas single tap", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:8124",
      viewport: { width: 390, height: 820 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').tap();
    await expect(page.locator("#pTitle")).toBeVisible();
    const point = await emptyCanvasPoint(page);
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.locator("#popover")).toBeHidden();
    await context.close();
  });

  test("adds list items reliably without nested component scrolling", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').dblclick();
    await expect(page.locator("#pTitle")).toBeVisible();
    await page.locator("#pAddList").click();

    const listEditor = page.locator(".component-editor").filter({ hasText: "List" });
    const itemInputs = listEditor.locator(".list-item-editor input");
    await expect(itemInputs).toHaveCount(2);

    await listEditor.locator(".component-add-item").click();
    await expect(itemInputs).toHaveCount(3);
    await expect.poll(() => itemInputs.last().evaluate(el => document.activeElement === el)).toBe(true);

    await itemInputs.last().fill("Remember me option");
    await expect.poll(async () => {
      const model = await savedModel(page);
      const login = model.states.find(state => state.id === "login");
      return login.components.find(component => component.type === "list")?.text || "";
    }).toContain("Remember me option");

    await expect(page.locator("#pComponents")).toHaveCSS("overflow", "visible");
    await expect(page.locator("#pComponents")).toHaveCSS("scrollbar-width", "none");
    await expect(page.locator("#popover")).toHaveCSS("scrollbar-color", "rgb(49, 95, 140) rgb(7, 19, 33)");
    await expect.poll(async () => {
      const box = await page.locator("#popover").boundingBox();
      return Math.round(box?.width || 0);
    }).toBeGreaterThanOrEqual(380);
  });

  test("does not reroute when Alt-drag starts from the line body", async ({ page }) => {
    await openTool(page);
    const label = page.locator("svg text.edge-label").filter({ hasText: "Login" });
    await expect(label).toHaveCount(1);
    const start = await centerOf(label);
    const end = await centerOf(page.locator('[data-id="register"] .input-port'));

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
    const loginEdgeId = await page.evaluate(key => {
      const model = JSON.parse(localStorage.getItem(key));
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

  test("pans with trackpad-style wheel and keeps zoom on Ctrl-wheel", async ({ page }) => {
    await openTool(page);
    const mapBox = await page.locator("#map").boundingBox();
    await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    const beforePan = await worldTransform(page);

    await page.mouse.wheel(120, 80);
    await expect.poll(() => worldTransform(page)).not.toBe(beforePan);

    const afterPan = await worldTransform(page);
    const zoomBefore = await page.locator("#zoomLevel").innerText();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -180);
    await page.keyboard.up("Control");

    await expect.poll(() => page.locator("#zoomLevel").innerText()).not.toBe(zoomBefore);
    expect(await worldTransform(page)).not.toBe(afterPan);
  });

  test("accumulates tiny desktop pinch wheel deltas reliably", async ({ page }) => {
    await openTool(page);
    const mapBox = await page.locator("#map").boundingBox();
    const anchor = {
      x: mapBox.x + mapBox.width * 0.42,
      y: mapBox.y + mapBox.height * 0.48
    };
    const before = await worldTransform(page);
    const zoomBefore = Number((await page.locator("#zoomLevel").innerText()).replace("%", ""));

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

    await expect.poll(async () => Number((await page.locator("#zoomLevel").innerText()).replace("%", "")))
      .toBeGreaterThan(zoomBefore + 2);
    expect(await worldTransform(page)).not.toBe(before);
  });

  test("empty-canvas drag pans immediately; long-press enables rectangle select", async ({ page }) => {
    await openTool(page);
    const nodeBox = await page.locator('[data-id="auth_start"]').boundingBox();
    const start = { x: nodeBox.x - 24, y: nodeBox.y - 24 };
    const end = { x: nodeBox.x + nodeBox.width + 24, y: nodeBox.y + nodeBox.height + 24 };
    const beforeDrag = await worldTransform(page);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 80, start.y + 30, { steps: 6 });
    await page.mouse.up();

    await expect.poll(() => worldTransform(page)).not.toBe(beforeDrag);
    await expect(page.locator("#selectionActions")).toBeHidden();

    await page.getByRole("button", { name: "Fit" }).click();
    const nodeBoxAfterFit = await page.locator('[data-id="auth_start"]').boundingBox();
    const selectStart = { x: nodeBoxAfterFit.x - 24, y: nodeBoxAfterFit.y - 24 };
    const selectEnd = { x: nodeBoxAfterFit.x + nodeBoxAfterFit.width + 24, y: nodeBoxAfterFit.y + nodeBoxAfterFit.height + 24 };

    await page.mouse.move(selectStart.x, selectStart.y);
    await page.mouse.down();
    await page.waitForTimeout(410);
    await page.mouse.move(selectEnd.x, selectEnd.y, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator("#selectionActions")).toBeVisible();
    await expect(page.locator("#selectionCount")).toContainText("state");
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
  });
});
