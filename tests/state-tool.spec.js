const fs = require("node:fs");
const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "stateBlueprintHotLinked.model.v2";

async function openTool(page) {
  await page.addInitScript(key => {
    for (const name of [key, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`]) {
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
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
}

async function savedStateTemplates(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(`${key}.stateExplorer`) || "[]"), STORAGE_KEY);
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
        if (el.closest(".popover, .state-explorer, .node, .edge, .hit, .edge-label, .edge-tip-hit, .zoom-controls, .help, .selection-actions")) continue;
        return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("Could not find an empty canvas point");
  return point;
}

async function dragNodeToStateExplorer(page, node) {
  const nodeBox = await visibleBox(node);
  const explorerBox = await visibleBox(page.locator("#stateExplorer"));
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(explorerBox.x + explorerBox.width / 2, explorerBox.y + explorerBox.height / 2, { steps: 14 });
  await page.mouse.up();
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
    await page.locator("#pBody").fill("Tell us who should receive the short lesson.");
    await page.locator("#pData").fill('{"userName":"Ada","profile":{"tier":"starter"}}');
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "start").data.profile?.tier;
    }).toBe("starter");

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
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "start").components.find(component => component.type === "link")?.url;
    }).toBe("https://example.com/docs");
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

    await page.locator(`[data-id="${createdStateId}"]`).click();
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
      for (const name of [key, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`]) {
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

  test("persists every state component field across reopening and renders them in the app", async ({ page }) => {
    await openTool(page);
    const imageUrl = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iNjAiPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iNjAiIGZpbGw9IiMyNTYzZWIiLz48L3N2Zz4=";

    await page.locator('[data-id="login"]').click();
    await page.locator("#pData").fill('{"userName":"Ada"}');
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login").data.userName;
    }).toBe("Ada");

    await page.getByRole("button", { name: "+ Heading" }).click();
    await componentEditor(page, "Heading").locator("input").fill("Account heading {{userName}}");

    await page.getByRole("button", { name: "+ Text" }).click();
    await componentEditor(page, "Text").locator("textarea").fill("Body paragraph for {{userName}}");

    await page.getByRole("button", { name: "+ Image" }).click();
    await componentEditor(page, "Image").locator("input").nth(0).fill("Chart for {{userName}}");
    await componentEditor(page, "Image").locator("input").nth(1).fill(imageUrl);

    await page.getByRole("button", { name: "+ List" }).click();
    const listEditor = componentEditor(page, "List");
    await listEditor.locator(".list-item-editor input").nth(0).fill("First step for {{userName}}");
    await listEditor.locator(".list-item-editor input").nth(1).fill("Second step");
    await listEditor.locator(".component-add-item").click();
    await expect(listEditor.locator(".list-item-editor input")).toHaveCount(3);
    await listEditor.locator(".list-item-editor input").nth(2).fill("Third persisted step");

    await page.getByRole("button", { name: "+ Link" }).click();
    await componentEditor(page, "Link").locator("input").nth(0).fill("Docs for {{userName}}");
    await componentEditor(page, "Link").locator("input").nth(1).fill("https://example.com/{{userName}}/docs");

    await page.getByRole("button", { name: "+ Note" }).click();
    await componentEditor(page, "Note").locator("textarea").fill("Note survives for {{userName}}");

    await page.getByRole("button", { name: "+ Divider" }).click();

    await expect.poll(async () => {
      const model = await savedModel(page);
      const login = model.states.find(state => state.id === "login");
      return login.components.map(component => ({
        type: component.type,
        text: component.text,
        url: component.url
      }));
    }).toEqual([
      { type: "heading", text: "Account heading {{userName}}", url: "" },
      { type: "text", text: "Body paragraph for {{userName}}", url: "" },
      { type: "image", text: "Chart for {{userName}}", url: imageUrl },
      { type: "list", text: "First step for {{userName}}\nSecond step\nThird persisted step", url: "" },
      { type: "link", text: "Docs for {{userName}}", url: "https://example.com/{{userName}}/docs" },
      { type: "note", text: "Note survives for {{userName}}", url: "" },
      { type: "divider", text: "", url: "" }
    ]);

    await page.keyboard.press("Escape");
    await expect(page.locator("#popover")).toBeHidden();
    await page.locator('[data-id="login"]').click();

    await expect(componentEditor(page, "Heading").locator("input")).toHaveValue("Account heading {{userName}}");
    await expect(componentEditor(page, "Text").locator("textarea")).toHaveValue("Body paragraph for {{userName}}");
    await expect(componentEditor(page, "Image").locator("input").nth(0)).toHaveValue("Chart for {{userName}}");
    await expect(componentEditor(page, "Image").locator("input").nth(1)).toHaveValue(imageUrl);
    await expect(componentEditor(page, "List").locator(".list-item-editor input")).toHaveCount(3);
    await expect(componentEditor(page, "List").locator(".list-item-editor input").nth(0)).toHaveValue("First step for {{userName}}");
    await expect(componentEditor(page, "List").locator(".list-item-editor input").nth(1)).toHaveValue("Second step");
    await expect(componentEditor(page, "List").locator(".list-item-editor input").nth(2)).toHaveValue("Third persisted step");
    await expect(componentEditor(page, "Link").locator("input").nth(0)).toHaveValue("Docs for {{userName}}");
    await expect(componentEditor(page, "Link").locator("input").nth(1)).toHaveValue("https://example.com/{{userName}}/docs");
    await expect(componentEditor(page, "Note").locator("textarea")).toHaveValue("Note survives for {{userName}}");
    await expect(componentEditor(page, "Divider")).toBeVisible();

    await page.keyboard.press("Escape");
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

  test("opens state edits in the left inspector without stealing canvas-click focus", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
    await expect(page.locator("#stateInspectorBody")).toBeVisible();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Login");
    await expect(page.locator("#popover")).toBeHidden();
    await expect(page.locator("#pTitle")).toHaveValue("Login");
    await expect(page.locator("#pTitle")).toHaveAttribute("tabindex", "0");
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(false);
    await expect(page.locator('[data-id="login"]')).toHaveClass(/selected/);
    await expect(appFrame(page).locator("#statePill")).toHaveText("login");

    await page.locator("#pTitle").fill("Sign in");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in");
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Sign in");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login").title;
    }).toBe("Sign in");

    const reloaded = await page.context().newPage();
    await reloaded.goto("/state.html");
    await expect(reloaded.locator('[data-id="login"] .title')).toHaveText("Sign in");
    await reloaded.locator('[data-id="login"] .node-edit').click();
    await expect(reloaded.locator("#pTitle")).toHaveValue("Sign in");
    await expect.poll(() => reloaded.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);
    await expect(reloaded.locator("#popover")).toBeHidden();
    await reloaded.close();
  });

  test("keeps inspector collapsible, selected-state aware, and separate from edge popovers", async ({ page }) => {
    await openTool(page);

    const mapBefore = await visibleBox(page.locator("#map"));
    await page.locator('[data-id="login"]').click();
    await expect(page.locator("#pTitle")).toHaveValue("Login");

    await page.locator("#btnToggleInspector").click();
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await expect(page.locator("#btnToggleInspector")).toHaveAttribute("aria-label", "Expand state inspector");
    await expect(page.locator("#pTitle")).toBeHidden();
    const mapCollapsed = await visibleBox(page.locator("#map"));
    expect(mapCollapsed.width).toBeGreaterThan(mapBefore.width + 60);

    await page.locator("#btnToggleInspector").click();
    await expect(page.locator(".workspace")).not.toHaveClass(/inspector-collapsed/);
    await expect(page.locator("#pTitle")).toHaveValue("Login");

    const label = page.locator("svg text.edge-label").filter({ hasText: "Login" });
    await expect(label).toHaveCount(1);
    await label.click();
    await expect(page.locator("#pLabel")).toBeVisible();
    await expect(page.locator("#pTitle")).toHaveValue("Login");

    await page.keyboard.press("Escape");
    await expect(page.locator("#popover")).toBeHidden();
    await page.locator('[data-id="register"]').click();
    await expect(page.locator("#popover")).toBeHidden();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Register");
    await expect(page.locator("#pTitle")).toHaveValue("Register");
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

  test("uses tool undo and redo even when an editor input is focused", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').click();
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

    await page.locator('[data-id="login"] .node-edit').click();
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

  test("start-here focuses first runtime input, preserves default tab order, and submits positive action with Enter", async ({ page }) => {
    await openTool(page);
    const app = appFrame(page);

    await page.locator('[data-id="login"]').click();
    await page.locator("#pStartHere").click();
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
    await appFrame(page).getByRole("button", { name: "Next" }).click();
    await expect(appFrame(page).locator("#statePill")).toHaveText("start");
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
    await expect(page.locator(".edge")).toHaveCount(0);
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

  test("reroutes an existing transition into a self-loop from the arrowhead", async ({ page }) => {
    await openTool(page);
    const loginEdgeId = await page.evaluate(key => {
      const model = JSON.parse(localStorage.getItem(key));
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

  test("clears state inspector on empty canvas and closes edge popovers on outside click", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
    await expect(page.locator("#pTitle")).toBeVisible();
    let point = await emptyCanvasPoint(page);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator("#pTitle")).toHaveCount(0);
    await expect(page.locator("#stateInspectorBody")).toContainText("No state selected");
    await expect(page.locator("#popover")).toBeHidden();

    const label = page.locator("svg text.edge-label").filter({ hasText: "Login" });
    await expect(label).toHaveCount(1);
    await label.click();
    await expect(page.locator("#pLabel")).toBeVisible();
    point = await emptyCanvasPoint(page);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator("#popover")).toBeHidden();
  });

  test("keeps focused state inspector stable with Escape", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').click();
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(page.locator("#popover")).toBeHidden();
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
    await expect(page.locator("#pTitle")).toHaveCount(0);
    await expect(page.locator("#stateInspectorBody")).toContainText("No state selected");
    await context.close();
  });

  test("adds list items reliably without nested component scrolling", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
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

  test("reroutes to a self-loop with mobile long-press", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await openTool(page);
    const loginEdgeId = await page.evaluate(key => {
      const model = JSON.parse(localStorage.getItem(key));
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

    const zoomBefore = await page.locator("#zoomLevel").innerText();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -180);
    await page.keyboard.up("Control");

    await expect.poll(() => page.locator("#zoomLevel").innerText()).not.toBe(zoomBefore);
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
      .toBeGreaterThanOrEqual(zoomBefore + 2);
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

  test("shift-click toggles mixed selections and undo redo restores empty-canvas deselection", async ({ page }) => {
    await openTool(page);
    const loginEdgeId = await page.evaluate(key => {
      const model = JSON.parse(localStorage.getItem(key));
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
    await expect(page.locator("#popover")).toBeHidden();

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
    await page.locator("#pBody").fill("A reusable sign-in screen");
    await page.locator("#pData").fill('{"role":"member"}');

    await dragNodeToStateExplorer(page, login);

    const template = page.locator(".state-template-card").filter({ hasText: "Reusable login" });
    await expect(template).toBeVisible();
    await expect(page.locator("#stateExplorer")).not.toHaveClass(/collapsed/);
    await expect(page.locator(".node")).toHaveCount(6);
    await expect(login).toBeVisible();
    const afterDropBox = await visibleBox(login);
    expect(Math.abs(afterDropBox.x - originalBox.x)).toBeLessThan(2);
    expect(Math.abs(afterDropBox.y - originalBox.y)).toBeLessThan(2);

    await expect.poll(async () => {
      const templates = await savedStateTemplates(page);
      return templates.map(template => ({
        title: template.title,
        body: template.body,
        role: template.data?.role
      }));
    }).toEqual([{ title: "Reusable login", body: "A reusable sign-in screen", role: "member" }]);

    await dragNodeToStateExplorer(page, login);
    await expect(page.locator(".state-template-card")).toHaveCount(1);
    await expect.poll(async () => (await savedStateTemplates(page)).length).toBe(1);

    await page.keyboard.press("Control+Space");
    await expect(page.locator("#stateExplorer")).toHaveClass(/collapsed/);
    await page.keyboard.press("Control+Space");
    await expect(page.locator("#stateExplorer")).not.toHaveClass(/collapsed/);
  });

  test("reuses state explorer presets as stable snapshots across reload, drag, and double click", async ({ page }) => {
    await openTool(page);
    const login = page.locator('[data-id="login"]');

    await login.click();
    await page.locator("#pTitle").fill("Reusable login");
    await page.locator("#pBody").fill("Welcome {{role}}");
    await page.locator("#pData").fill('{"role":"member"}');
    await page.getByRole("button", { name: "+ Heading" }).click();
    await componentEditor(page, "Heading").locator("input").fill("Preset heading {{role}}");
    await page.getByRole("button", { name: "+ Link" }).click();
    await componentEditor(page, "Link").locator("input").nth(0).fill("Preset docs");
    await componentEditor(page, "Link").locator("input").nth(1).fill("https://example.com/preset");
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
    await expect(workPage.locator("#pBody")).toHaveValue("Welcome {{role}}");
    await expect(workPage.locator("#pData")).toHaveValue(/"role": "member"/);
    await expect(componentEditor(workPage, "Heading").locator("input")).toHaveValue("Preset heading {{role}}");
    await expect(componentEditor(workPage, "Link").locator("input").nth(1)).toHaveValue("https://example.com/preset");
    await expect(appFrame(workPage).getByRole("heading", { name: "Preset heading member" })).toBeVisible();
    await expect(appFrame(workPage).getByRole("link", { name: "Preset docs" })).toHaveAttribute("href", "https://example.com/preset");

    const createdId = await workPage.locator(".node.selected").getAttribute("data-id");
    await workPage.locator("#pBody").fill("Edited instance only");
    await expect.poll(async () => {
      const templates = await savedStateTemplates(workPage);
      return templates[0].body;
    }).toBe("Welcome {{role}}");

    await template.dblclick();
    await expect(workPage.locator(".node")).toHaveCount(8);
    await expect(workPage.locator("#pBody")).toHaveValue("Welcome {{role}}");

    await expect.poll(async () => {
      const model = await savedModel(workPage);
      const reusableStates = model.states.filter(state => state.title === "Reusable login");
      return {
        count: reusableStates.length,
        editedBody: model.states.find(state => state.id === createdId)?.body,
        snapshotBodies: reusableStates.map(state => state.body).sort()
      };
    }).toEqual({
      count: 3,
      editedBody: "Edited instance only",
      snapshotBodies: ["Edited instance only", "Welcome {{role}}", "Welcome {{role}}"]
    });
    await workPage.close();
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
