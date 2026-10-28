const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/static",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:8766/webrtl/" },
  webServer: {
    command: "python3 -m http.server 8766 --bind 127.0.0.1 --directory .build/pages",
    url: "http://127.0.0.1:8766/webrtl/",
    reuseExistingServer: false,
  },
});
