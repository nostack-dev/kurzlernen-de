const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "stateBlueprintHotLinked.model.v2";

function appFrame(page) {
  return page.frameLocator("#appFrame");
}

function nestedCompositeModel() {
  return {
    version: 2,
    name: "Nested Regression Flow",
    initial: "state_6",
    boundary: {
      entryId: "start",
      exitId: "state_2",
      entryDisabled: false,
      exitDisabled: false
    },
    states: [
      { id: "start", title: "Start", body: "", components: [], data: {}, parentId: null, x: 96, y: 168, boundary: { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false } },
      { id: "state_2", title: "State 2", body: "", components: [], data: {}, parentId: null, x: 360, y: 168, boundary: { entryId: "state_6", exitId: "state_5", entryDisabled: false, exitDisabled: false } },
      { id: "state_6", title: "State 6", body: "", components: [], data: {}, parentId: "state_2", x: 96, y: 168, boundary: { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false } },
      { id: "state_3", title: "State 3", body: "", components: [], data: {}, parentId: "state_2", x: 360, y: 168, boundary: { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false } },
      { id: "state_4", title: "State 4", body: "", components: [], data: {}, parentId: "state_3", x: 192, y: 168, boundary: { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false } },
      { id: "state_5", title: "State 5", body: "", components: [], data: {}, parentId: "state_2", x: 648, y: 168, boundary: { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false } }
    ],
    transitions: [
      { id: "t_start_parent", from: "start", to: "state_2", label: "Next", condition: "", set: {}, groupEntryId: "", groupExitId: "" },
      { id: "t_child_to_parent", from: "state_6", to: "state_3", label: "Next", condition: "", set: {}, groupEntryId: "", groupExitId: "" },
      { id: "t_parent_to_done", from: "state_3", to: "state_5", label: "Next", condition: "", set: {}, groupEntryId: "", groupExitId: "" }
    ]
  };
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

async function savedModel(page) {
  return page.evaluate(key => {
    const stored = JSON.parse(localStorage.getItem(key) || "null");
    if (stored) return stored;
    if (typeof model !== "undefined") return JSON.parse(JSON.stringify(model));
    return null;
  }, STORAGE_KEY);
}

test.describe("Nested runtime regressions", () => {
  test("generated app flow renders composite states before child states and canvas follows layers @smoke", async ({ page }) => {
    await openWithModel(page, nestedCompositeModel());
    const app = appFrame(page);

    await expect(app.locator("#statePill")).toHaveText("state_6");
    await expect(app.locator("h1")).toHaveText("State 6");

    await app.getByRole("button", { name: "Next" }).click();
    await expect(app.locator("#statePill")).toHaveText("state_3");
    await expect(app.locator("h1")).toHaveText("State 3");
    await expect(app.locator("h1")).not.toHaveText(/State 3\s*\/\s*State 4/);
    await expect(page.locator('[data-id="state_3"]')).toBeVisible();
    await expect(page.locator('[data-id="state_4"]')).toHaveCount(0);

    await expect.poll(async () => {
      const model = await savedModel(page);
      const state3 = model.states.find(state => state.id === "state_3");
      const boundaryEdges = model.transitions.filter(transition => transition.boundaryFlow?.parentId === "state_3");
      return {
        entryId: state3.boundary.entryId,
        exitId: state3.boundary.exitId,
        boundaryEdges: boundaryEdges.map(edge => `${edge.boundaryFlow.side}:${edge.boundaryFlow.stateId}`).sort()
      };
    }).toEqual({
      entryId: "state_4",
      exitId: "state_4",
      boundaryEdges: ["input:state_4", "output:state_4"]
    });

    await page.waitForTimeout(320);
    await app.getByRole("button", { name: "State 4" }).click();
    await expect(app.locator("#statePill")).toHaveText("state_4");
    await expect(app.locator("h1")).toHaveText("State 4");
    await expect(app.getByText("No outgoing transitions")).toHaveCount(0);
    await expect(page.locator('[data-id="state_4"]')).toBeVisible();

    await page.waitForTimeout(320);
    await app.getByRole("button", { name: "Next" }).click();
    await expect(app.locator("#statePill")).toHaveText("state_5");
    await expect(app.locator("h1")).toHaveText("State 5");
    await expect(page.locator('[data-id="state_5"]')).toBeVisible();
    await expect(page.locator('[data-id="state_4"]')).toHaveCount(0);
  });
});
