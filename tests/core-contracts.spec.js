const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "stateBlueprintHotLinked.model.v2";

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

async function openTool(page) {
  await page.addInitScript(key => {
    for (const name of [key, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
      localStorage.removeItem(name);
    }
  }, STORAGE_KEY);
  await page.goto("/state.html");
  await expect(page.locator('[data-id="auth_start"]')).toBeVisible();
}

async function openWithModel(page, model) {
  await page.addInitScript(({ key, model }) => {
    for (const name of [key, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
      localStorage.removeItem(name);
    }
    localStorage.setItem(key, JSON.stringify(model));
  }, { key: STORAGE_KEY, model });
  await page.goto("/state.html");
  await expect(appFrame(page).locator("#statePill")).toHaveText(model.initial);
}

test.describe("Core source contracts", () => {
  test("generated self-contained app script stays syntactically valid @smoke", () => {
    const appHtml = generatedAppHtml();
    const scripts = [...appHtml.matchAll(/<script>\s*([\s\S]*?)<\/script>/gi)].map(match => match[1]);

    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(() => new Function(script)).not.toThrow();
    }
  });

  test("generated runtime keeps user content clean and event-driven @smoke", () => {
    const appHtml = generatedAppHtml();
    const actionHandler = appHtml.match(/button\.onclick = \(\) => \{[\s\S]*?\n\s*\};/);
    const html = stateHtml();

    expect(appHtml).not.toContain("No outgoing transitions");
    expect(appHtml).not.toContain("Play default chime");
    expect(html).not.toContain('text: "{{fetch.data}}"');
    expect(html).not.toContain('text: "{{item}}"');
    expect(html).not.toContain('text: "Item: {{item}}"');
    expect(actionHandler?.[0] || "").toContain("emitRuntimeEvent");
    expect(actionHandler?.[0] || "").not.toContain("followTransition");
  });

  test("list item editors use non-overlapping layout classes @smoke", () => {
    const html = stateHtml();

    expect(html).toContain('itemHead.className = "list-item-head"');
    expect(html).toContain('textField.className = "field list-item-field"');
    expect(html).toContain('urlField.className = "field list-item-field"');
    expect(html).toContain(".list-item-head");
    expect(html).toContain("grid-template-columns: minmax(0, 1fr) auto");
  });

  test("repeat sources derive readable components from array samples @smoke", () => {
    const html = stateHtml();
    const appHtml = generatedAppHtml();

    expect(html).toContain("function derivedRepeatComponents");
    expect(html).toContain("function pickDerivedRepeatFields");
    expect(html).toContain("function repeatSampleForPath");
    expect(html).toContain("generatedFromRepeat");
    expect(html).toContain("applyDerivedRepeatComponents(owner, owner.repeat.path, root, false)");
    expect(html).toContain("derivedRepeatComponents(sample, \"item\")");
    expect(appHtml).toContain("function runtimeDerivedRepeatComponents");
    expect(appHtml).toContain("function readableRepeatComponentsForRuntime");
    expect(appHtml).toContain("runtimeComponentIsRawDataDump");
  });

  test("fetch runtime uses one fresh active run, not a response cache @smoke", () => {
    const html = stateHtml();

    expect(html).toContain("let dataSourceRunSerial = 0");
    expect(html).toContain("let activeDataSourceRun = null");
    expect(html).toContain("await ensureStateDataSource(s)");
    expect(html).toContain("data: null");
    expect(html).toContain("count: 0");
    expect(html).toContain("error: \"\"");
    expect(html).not.toContain("dataSourceRuns = new Map");
    expect(html).not.toContain("dataSourceRuns.");
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

  test("only Delete removes selected graph items, Backspace does not @smoke", () => {
    const html = stateHtml();

    expect(html).toContain('evt.key === "Delete" && deleteActiveSelection()');
    expect(html).not.toContain('evt.key === "Backspace" && deleteActiveSelection()');
  });
});

test.describe("Core browser contracts", () => {
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
    await expect(app.getByRole("button", { name: /^Next$/ })).toBeVisible();
    await expect(app.getByRole("button", { name: /^Next2$/ })).toBeVisible();

    await app.getByRole("button", { name: /^Next2$/ }).click();

    await expect(app.locator("#statePill")).toHaveText("sound");
    await expect(app.locator("h1")).toHaveText("Play sound");
  });

  test("state editor exposes global-state path subscriptions without output editing @smoke", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();

    await expect(page.getByText("Global State JSON")).toBeVisible();
    await expect(page.locator("#pSubscriptionTree")).toBeVisible();
    await expect(page.locator("#pSubscriptionAdd")).toBeVisible();
    await expect(page.locator("#pOutputs")).toHaveCount(0);
  });

  test("component text editors insert global-state bindings from a picker @smoke", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="auth_start"]').click();

    const picker = page.locator(".template-binding-picker").first();
    await expect(picker).toBeVisible();
    await picker.locator("select").selectOption("state.current");
    await picker.getByRole("button", { name: "+" }).click();

    await expect(page.locator(".component-editor textarea").first()).toHaveValue(/{{state\.current}}/);
  });

  test("global state json tree branches can collapse and expand @smoke", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="auth_start"]').click();

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

    await page.locator('[data-id="auth_start"]').click();

    const repeat = page.locator("#pRepeatPath");
    await expect(repeat).toHaveJSProperty("tagName", "SELECT");
    await expect(repeat.locator("option", { hasText: "No repeat" })).toBeVisible();
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
