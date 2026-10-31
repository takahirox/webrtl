const { defineConfig } = require("@playwright/test");

// Test an existing build: publishing must upload exactly the bytes tested here.
module.exports = defineConfig({
  testDir: "./tests/pages",
  timeout: 120_000,
  globalTimeout: 180_000,
  retries: 0,
  workers: 1,
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  use: {
    baseURL: "http://127.0.0.1:8766/webrtl/",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "python3 tests/serve_static.py",
    url: "http://127.0.0.1:8766/webrtl/",
    timeout: 15_000,
    reuseExistingServer: false,
  },
});
