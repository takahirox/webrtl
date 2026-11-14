const { existsSync, readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { join } = require("node:path");
const { compilationFingerprint } = require("./circuit-fingerprint.cjs");

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function cacheIdentity(browserVersion) {
  return compilationFingerprint(".build/pages/webrtl", {
    browser: browserVersion, board: "snes", frontend: "slang", top: "snes", format: 1,
  });
}
function loadCircuit(directory, identity) {
  if (!existsSync(directory)) return null;
  // A restored but incomplete, corrupted or foreign cache is a real provenance
  // failure. Never silently substitute it or label it a fresh compilation.
  const metadata = JSON.parse(readFileSync(join(directory, "metadata.json")));
  const wasm = readFileSync(join(directory, "snes.wasm"));
  if (metadata.identity !== identity || !/^[a-f0-9]{40}$/.test(metadata.sourceSha || "") ||
      metadata.digest !== digest(wasm) || !WebAssembly.validate(wasm)) throw new Error("Invalid SNES compilation cache provenance");
  return { wasm: Array.from(wasm), metrics: metadata.metrics, sourceSha: metadata.sourceSha };
}
function saveCircuit(directory, identity, compiled, sourceSha) {
  const wasm = Buffer.from(compiled.wasm);
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || !WebAssembly.validate(wasm)) throw new Error("Invalid compiled SNES evidence");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "snes.wasm"), wasm);
  writeFileSync(join(directory, "metadata.json"), JSON.stringify({ identity, sourceSha, digest: digest(wasm), metrics: compiled.metrics }));
}
module.exports = { cacheIdentity, loadCircuit, saveCircuit };
