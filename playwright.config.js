const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30000,
  expect: {
    timeout: 5000
  },
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:8124",
    trace: "on-first-retry",
    viewport: { width: 1280, height: 820 }
  },
  webServer: {
    command: "node tests/serve-state.mjs",
    url: "http://127.0.0.1:8124/state.html",
    reuseExistingServer: !process.env.CI,
    timeout: 10000
  }
});
