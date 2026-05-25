const fs = require("node:fs");
const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "stateBlueprintHotLinked.model.v2";
const GRID_SIZE = 24;

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

async function assertNoOverlap(page, firstSelector, secondSelector) {
  const [first, second] = await Promise.all([
    page.locator(firstSelector).boundingBox(),
    page.locator(secondSelector).boundingBox()
  ]);
  if (!first) throw new Error(`${firstSelector} is not visible`);
  if (!second) throw new Error(`${secondSelector} is not visible`);
  const overlaps =
    Math.max(first.x, second.x) < Math.min(first.x + first.width, second.x + second.width) &&
    Math.max(first.y, second.y) < Math.min(first.y + first.height, second.y + second.height);
  expect(overlaps).toBe(false);
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
          output: { x: left + width, y: top + height / 2 },
          input: { x: left, y: top + height / 2 }
        };
      }),
      paths: [...document.querySelectorAll(".edge")].map(edge => {
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
      pins: [...document.querySelectorAll(".edge-pin")].map(pin => ({
        id: pin.dataset.edgeId,
        side: pin.dataset.edgePin,
        x: Number.parseFloat(pin.getAttribute("cx")),
        y: Number.parseFloat(pin.getAttribute("cy")),
        fill: getComputedStyle(pin).fill,
        stroke: getComputedStyle(pin).stroke
      }))
    };
  }, GRID_SIZE);
}

function segmentIntersectsNode(segment, node) {
  const x1 = node.left;
  const x2 = node.left + node.width;
  const y1 = node.top;
  const y2 = node.top + node.height;
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

  test("keeps the DOM and SVG map renderer as the fallback path", async ({ page }) => {
    await page.addInitScript(key => {
      for (const name of [key, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`]) {
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
      for (const name of [key, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`]) {
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
    await expect(page.locator(".node")).toHaveCount(6);
    await expect.poll(() => page.locator("#mapScene").evaluate(el => el.parentElement?.id)).toBe("mapCanvas");
    await expect.poll(() => page.evaluate(() => window.__htmlInCanvasDraws || 0)).toBeGreaterThan(0);
    await expect(page.locator("#mapCanvas")).toHaveAttribute("data-drawn", "true");
    await expect.poll(() => page.evaluate(() => window.__htmlInCanvasLastDraw)).toEqual({ id: "mapScene", x: 0, y: 0 });
  });

  test("opens state edits in the left inspector with focused input and Enter commit close", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
    await expect(page.locator("#stateInspectorBody")).toBeVisible();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Login");
    await expect(page.locator("#popover")).toBeHidden();
    await expect(page.locator("#pTitle")).toHaveValue("Login");
    await expect(page.locator("#pTitle")).toHaveAttribute("tabindex", "0");
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);
    await expect(page.locator('[data-id="login"]')).toHaveClass(/selected/);
    await expect(appFrame(page).locator("#statePill")).toHaveText("login");

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

    const loginEnd = loginSuccess.points.at(-1);
    const registerEnd = registerSuccess.points.at(-1);
    expect(loginEnd.x).toBe(registerEnd.x);
    expect(loginEnd.y).not.toBe(registerEnd.y);

    for (const transition of model.transitions.filter(item =>
      item.from === "auth_start" ||
      item.to === "logged_in"
    )) {
      expect(report.pins.filter(pin => pin.id === transition.id)).toHaveLength(2);
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
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
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
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
    }, { key: STORAGE_KEY, model: obstacleModel });
    await page.goto("/state.html");
    await expect(page.locator(".node")).toHaveCount(3);

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
        expect(segmentIntersectsNode(segment, node)).toBe(false);
      }
    }

    const bypassesObstacle = route.points.some(point => point.y < obstacle.top || point.y > obstacle.top + obstacle.height);
    expect(bypassesObstacle).toBe(true);
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

  test("keeps transition editor focus, tab order, and Enter commit close predictable", async ({ page }) => {
    await openTool(page);

    const label = page.locator("svg text.edge-label").filter({ hasText: "Login" });
    await expect(label).toHaveCount(1);
    await label.click();

    await expect(page.locator("#pLabel")).toBeVisible();
    await expect(page.locator("#pLabel")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pCond")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pSet")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pFlip")).toHaveAttribute("tabindex", "0");
    await expect.poll(() => page.locator("#pLabel").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pCond").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => page.locator("#pLabel").evaluate(el => document.activeElement === el)).toBe(true);
    await page.locator("#pLabel").fill("Sign in action");
    await page.keyboard.press("Enter");

    await expect(page.locator("#popover")).toBeHidden();
    await expect(page.locator("svg text.edge-label").filter({ hasText: "Sign in action" })).toHaveCount(1);
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.transitions.find(transition => transition.from === "auth_start" && transition.to === "login")?.label;
    }).toBe("Sign in action");
  });

  test("highlights clicked states and transitions and deletes selection with Delete even when editors are focused", async ({ page }) => {
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
    await expect(page.locator("#popover")).toBeHidden();
    await expect(loginEdge).toHaveCount(0);
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.transitions.some(t => t.id === loginEdgeId);
    }).toBe(false);

    await openTool(page);
    const login = page.locator('[data-id="login"]');
    await login.click();
    await expect(login).toHaveClass(/selected/);
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

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

    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);
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
    await appFrame(page).getByRole("button", { name: "Next" }).click();
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

    await expect(page.locator(".edge")).toHaveCount(before.transitions.length);
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

    await expect(page.locator(".edge")).toHaveCount(1);
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
    await expect(page.locator("#popover")).toBeHidden();
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

    await page.getByRole("button", { name: "+ Add preset" }).click();
    const preset = page.locator(".state-template-card").first();
    await expect(preset).toHaveClass(/editing/);
    await expect(preset.locator(".template-title-input")).toHaveCount(0);
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Template: State preset 1");
    await expect(page.locator("#stateInspector")).toHaveClass(/template-inspector/);
    await expect(page.locator("#stateInspectorBody")).toContainText("Reusable State Template");
    await expect(page.locator("#stateInspectorBody")).toContainText("Existing canvas states stay unchanged");
    await expect(page.locator("#pTitle")).toBeFocused();

    await page.locator("#pTitle").fill("Quick lesson");
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Template: Quick lesson");
    await page.locator("#pBody").fill("Hello {{role}}");
    await page.locator("#pData").fill('{"role":"mentor"}');
    await page.getByRole("button", { name: "+ Heading" }).click();
    await componentEditor(page, "Heading").locator("input").fill("Template heading {{role}}");
    await expect.poll(async () => {
      const templates = await savedStateTemplates(page);
      return {
        title: templates[0].title,
        body: templates[0].body,
        data: templates[0].data,
        heading: templates[0].components.find(component => component.type === "heading")?.text
      };
    }).toEqual({
      title: "Quick lesson",
      body: "Hello {{role}}",
      data: { role: "mentor" },
      heading: "Template heading {{role}}"
    });

    await preset.getByRole("button", { name: "Use" }).click();
    await expect(page.locator(".node")).toHaveCount(7);
    await expect(page.locator("#pTitle")).toHaveValue("Quick lesson");
    await expect(componentEditor(page, "Heading").locator("input")).toHaveValue("Template heading {{role}}");
    await expect(appFrame(page).getByRole("heading", { name: "Template heading mentor" })).toBeVisible();

    await page.locator('[data-id="login"]').click();
    await page.locator("#pTitle").fill("Updated reusable login");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login")?.title;
    }).toBe("Updated reusable login");
    await page.locator("#pBody").fill("Updated body {{role}}");
    await page.getByRole("button", { name: "+ Heading" }).click();
    await componentEditor(page, "Heading").locator("input").fill("Updated heading {{role}}");

    await preset.getByRole("button", { name: "Update" }).click();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Template: Updated reusable login");
    await expect.poll(async () => {
      const templates = await savedStateTemplates(page);
      return {
        title: templates[0].title,
        body: templates[0].body,
        heading: templates[0].components.find(component => component.type === "heading")?.text
      };
    }).toEqual({
      title: "Updated reusable login",
      body: "Updated body {{role}}",
      heading: "Updated heading {{role}}"
    });

    await expect(preset.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await preset.click();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Template: Updated reusable login");
    await expect(page.locator("#stateInspector")).toHaveClass(/template-inspector/);
    await expect(page.locator("#pBody")).toHaveValue("Updated body {{role}}");

    await preset.getByRole("button", { name: "Use" }).click();
    await expect(page.locator("#pTitle")).toHaveValue("Updated reusable login");
    await expect(componentEditor(page, "Heading").locator("input")).toHaveValue("Updated heading {{role}}");

    await preset.getByRole("button", { name: "Delete" }).click();
    await expect(page.locator(".state-template-card")).toHaveCount(0);
    await expect.poll(async () => (await savedStateTemplates(page)).length).toBe(0);
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

  test("keeps zoom controls clear of the state explorer", async ({ page }) => {
    await openTool(page);

    await expect(page.locator(".help")).toHaveCount(0);
    await assertVisibleInViewport(page, ".zoom-controls");
    await assertNoOverlap(page, ".zoom-controls", "#stateExplorer");
    await assertNoOverlap(page, ".zoom-controls", "#btnToggleStateExplorer");

    await page.locator("#btnToggleStateExplorer").click();
    await expect(page.locator("#stateExplorer")).toHaveClass(/collapsed/);
    await assertVisibleInViewport(page, ".zoom-controls");
    await assertNoOverlap(page, ".zoom-controls", "#stateExplorer");
    await assertNoOverlap(page, ".zoom-controls", "#btnToggleStateExplorer");
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
});
