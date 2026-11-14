const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { compilationFingerprint, circuitFingerprint } = require("./circuit-fingerprint.cjs");
const { loadCircuit, saveCircuit } = require("./pr-circuit-cache.cjs");

test("cross-revision reuse excludes only the SHA label, and rejects changed compiler, RTL and browser bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "webrtl-pr-identity-"));
  try {
    mkdirSync(join(directory, "tools"));
    const files = ["compiler.js", "tools/compiler.wasm", "snes.v", "debug-runtime.cpp"];
    for (const file of [...files, "build-info.json"]) writeFileSync(join(directory, file), "original");
    const identity = { browser: "chromium-156", board: "snes" };
    const before = compilationFingerprint(directory, identity);
    const full = circuitFingerprint(directory, identity);
    writeFileSync(join(directory, "build-info.json"), "new revision");
    assert.equal(compilationFingerprint(directory, identity), before);
    assert.notEqual(circuitFingerprint(directory, identity), full);
    for (const file of files) {
      writeFileSync(join(directory, file), "modified");
      assert.notEqual(compilationFingerprint(directory, identity), before, file);
      writeFileSync(join(directory, file), "original");
    }
    assert.notEqual(compilationFingerprint(directory, { ...identity, browser: "chromium-157" }), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("cache verifies identity, generating revision, digest, complete files and valid Wasm", () => {
  const root = mkdtempSync(join(tmpdir(), "webrtl-pr-cache-"));
  const directory = join(root, "cache");
  const compiled = { wasm: [0, 97, 115, 109, 1, 0, 0, 0], metrics: { compileMs: 123 } };
  const sha = "a".repeat(40);
  try {
    assert.equal(loadCircuit(directory, "identity"), null);
    saveCircuit(directory, "identity", compiled, sha);
    assert.deepEqual(loadCircuit(directory, "identity"), { ...compiled, sourceSha: sha });
    assert.throws(() => loadCircuit(directory, "foreign"), /provenance/);
    const original = readFileSync(join(directory, "metadata.json"), "utf8");
    const metadata = JSON.parse(original); metadata.sourceSha = "unknown";
    writeFileSync(join(directory, "metadata.json"), JSON.stringify(metadata));
    assert.throws(() => loadCircuit(directory, "identity"), /provenance/);
    writeFileSync(join(directory, "metadata.json"), original);
    writeFileSync(join(directory, "snes.wasm"), Buffer.from([1, 2, 3]));
    assert.throws(() => loadCircuit(directory, "identity"), /provenance/);
    assert.throws(() => saveCircuit(directory, "identity", { wasm: [1, 2] }, sha), /evidence/);
    rmSync(join(directory, "snes.wasm"));
    assert.throws(() => loadCircuit(directory, "identity"), /ENOENT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
