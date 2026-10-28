const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/browser",
  timeout: 180_000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:8765" },
  webServer: {
    command: "python3 server.py --trusted-local --port 8765",
    url: "http://127.0.0.1:8765",
    reuseExistingServer: false,
  },
});
