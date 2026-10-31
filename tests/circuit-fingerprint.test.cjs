const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { circuitFingerprint } = require("./circuit-fingerprint.cjs");

test("reuse rejects changed RTL, runtime, compiler bytes, browser and revision", () => {
  const site = mkdtempSync(join(tmpdir(), "webrtl-fingerprint-"));
  try {
    mkdirSync(join(site, "tools"));
    const inputs = ["snes.v", "simulator-worker.js", "tools/compiler.wasm", "build-info.json"];
    for (const input of inputs) writeFileSync(join(site, input), "original");
    const identity = { browser: "chromium-156", frontend: "slang", top: "snes" };
    const initial = circuitFingerprint(site, identity);
    assert.equal(circuitFingerprint(site, identity), initial);
    for (const input of inputs) {
      writeFileSync(join(site, input), "modified"); // Same size; mtimes are irrelevant.
      assert.notEqual(circuitFingerprint(site, identity), initial, input);
      writeFileSync(join(site, input), "original");
    }
    assert.notEqual(circuitFingerprint(site, { ...identity, browser: "firefox-157" }), initial);
    writeFileSync(join(site, "new-header.h"), "header");
    assert.notEqual(circuitFingerprint(site, identity), initial);
  } finally { rmSync(site, { recursive: true, force: true }); }
});
