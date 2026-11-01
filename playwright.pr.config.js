const { defineConfig } = require("@playwright/test");
const { genericTitles, snesTitle } = require("./tests/pr-selection.cjs");
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
process.env.WEBRTL_PR_SUITE = "1";
if (process.env.WEBRTL_SNES_FIXTURES) throw new Error("The PR suite cannot be overridden with WEBRTL_SNES_FIXTURES");

// A separate config prevents accidentally starting the complete corpus in CI.
module.exports = defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  globalTimeout: 510_000,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  reporter: [["line"], ["json", { outputFile: ".build/pr-results.json" }]],
  projects: [
    {
      name: "pr-generic", use: { browserName: "chromium" },
      testMatch: [/\/pages\/smoke\.spec\.js$/, /\/static\/(modes.*|outputs|workspace)\.spec\.js$/],
      grep: new RegExp(`(?:${genericTitles.map(escape).join("|")})$`),
    },
    {
      name: "pr-snes", use: { browserName: "chromium" },
      testMatch: /\/pr\/snes-smoke\.spec\.js$/,
      grep: new RegExp(`${escape(snesTitle)}$`),
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:8766/webrtl/",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "python3 tests/serve_static.py",
    url: "http://127.0.0.1:8766/webrtl/",
    reuseExistingServer: false,
  },
});
