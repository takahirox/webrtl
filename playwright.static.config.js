const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/static",
  timeout: 240_000,
  workers: 1,
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
  use: { baseURL: "http://127.0.0.1:8766/webrtl/" },
  webServer: {
    command: "python3 tests/serve_static.py",
    url: "http://127.0.0.1:8766/webrtl/",
    reuseExistingServer: false,
  },
});
