const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const dataURL = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const projectSource = readFileSync("web/project.js", "utf8");

test("page-local reuse recompiles changed HDL/configuration, validates references and creates independent simulators", async () => {
  let compilations = 0;
  const simulators = [];
  const NativeWorker = global.Worker;
  global.Worker = class {
    constructor(url) { this.compiler = String(url).includes("compiler-worker"); this.cycles = 0; if (!this.compiler) simulators.push(this); }
    postMessage(message, transfer = []) {
      // Model the real transfer boundary, which must not detach cached bytes.
      const data = structuredClone(message, { transfer });
      queueMicrotask(() => {
        if (this.compiler) {
          compilations++;
          this.onmessage({ data: { wasm: new Uint8Array([1, 2, 3]), metrics: {} } });
        } else {
          if (data.action === "init") assert.equal(data.wasm.length, 3);
          if (data.action === "step") this.cycles++;
          this.onmessage({ data: { id: data.id, count: this.cycles, cycles: this.cycles, io: [] } });
        }
      });
    }
    terminate() {}
  };
  try {
    const source = readFileSync("web/browser-client.js", "utf8")
      .replace('"./project.js"', JSON.stringify(dataURL(projectSource)))
      .replace('"./snes-rom.js"', JSON.stringify(dataURL(readFileSync("web/snes-rom.js", "utf8"))))
      .replaceAll("import.meta.url", JSON.stringify("http://localhost/browser-client.js"));
    const { compileBrowser: compile } = await import(dataURL(source));
    const { compilationKey } = await import(dataURL(projectSource));
    const compileBrowser = (project, progress, signal) => compile(project, progress, signal, true);
    const project = { top: "dut", board: "generic", files: { "dut.v": "module dut; endmodule", "ref.py": "print(1)" } };
    for (const board of [null, ""]) assert.notEqual(compilationKey({ ...project, board }), compilationKey({ ...project, board: undefined }));
    const first = await compileBrowser(project, () => {});
    await first._sim_step();
    project.files["ref.py"] = "print(2)";
    const second = await compileBrowser(project, () => {});
    assert.equal(compilations, 1);
    assert.equal(first._sim_count(), 1);
    assert.equal(second._sim_count(), 0);
    assert.equal(simulators.length, 2);
    const explicit = await compile(project, () => {});
    assert.equal(compilations, 2); // Explicit Compile always runs the real compiler.
    explicit._sim_destroy();
    second.metrics.changed = true;
    const third = await compileBrowser(project, () => {});
    assert.equal(third.metrics.changed, undefined);
    project.files["bad.py"] = "x".repeat(131072);
    await assert.rejects(() => compileBrowser(project, () => {}), /Source exceeds/);
    delete project.files["bad.py"];
    for (const mutation of [
      () => { project.files["dut.v"] += "\n// change"; },
      () => { project.files["helper.v"] = "module helper; endmodule"; },
      () => { project.top = "helper"; },
      () => { project.board = "counter"; },
      () => { project.frontend = "slang"; },
      () => { delete project.files["helper.v"]; },
    ]) {
      const before = compilations; mutation();
      const sim = await compileBrowser(project, () => {});
      sim._sim_destroy();
      assert.equal(compilations, before + 1);
    }
    const controller = new AbortController(); controller.abort();
    await assert.rejects(() => compileBrowser(project, () => {}, controller.signal), /cancelled/);
    for (const sim of [first, second, third]) sim._sim_destroy();
  } finally { global.Worker = NativeWorker; }
});
