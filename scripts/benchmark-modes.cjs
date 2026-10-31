// Manual, bounded browser benchmark; not an extra normal-CI gate.
// Build/serve the static site first. Pass the baseline Git revision explicitly.
const { chromium } = require("@playwright/test");
const { execFileSync } = require("node:child_process");
const { mkdirSync, writeFileSync, symlinkSync, existsSync } = require("node:fs");
const path = require("node:path");
const ref = process.argv[2];
if (!ref || !/^[a-zA-Z0-9_.\/-]+$/.test(ref)) throw new Error("Usage: node scripts/benchmark-modes.cjs BASELINE_REF [--snes]");
const baseline = path.resolve(".build/pages/webrtl/baseline");
mkdirSync(baseline, { recursive: true });
for (const name of ["compiler.js", "compiler-worker.js", "browser-client.js", "simulator-worker.js", "browser-simulator.cpp", "project.js", "output-contracts.js", "snes-rom.js"]) {
  writeFileSync(path.join(baseline, name), execFileSync("git", ["show", `${ref}:web/${name}`]));
}
if (!existsSync(path.join(baseline, "tools"))) symlinkSync("../tools", path.join(baseline, "tools"));
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(process.env.WEBRTL_BENCH_URL || "http://127.0.0.1:8766/webrtl/");
    const designs = [
      { name: "counter", board: "counter", top: "counter", urls: ["example.v"], batches: 512 },
      { name: "cpu-bus-ram", board: "counter", top: "bus_test", batches: 512,
        urls: ["bus-test.v", "bus-master.v", "bus-rom.v", "bus-ram.v", "bus-decoder.v"].map((n) => `examples/cpu-bus/${n}`) },
      ...(process.argv.includes("--snes") ? [{ name: "snes", board: "snes", top: "snes", frontend: "slang", batches: 32,
        urls: ["examples/snes/snes.v", "examples/snes/snes-core.v"] }] : []),
    ];
    const results = [];
    for (const design of designs) {
      results.push(await page.evaluate(async (design) => {
        const files = Object.fromEntries(await Promise.all(design.urls.map(async (url) => [url.split("/").at(-1), await (await fetch(url)).text()])));
        const measurements = [];
        for (const variant of ["baseline", "current"]) {
          const { compileBrowser } = await import(variant === "baseline" ? "./baseline/browser-client.js" : "./browser-client.js");
          const sim = await compileBrowser({ files, top: design.top, board: design.board, frontend: design.frontend }, () => {});
          try {
            if (design.board === "snes") await sim._sim_cartridge(new Uint8Array(await (await fetch("./examples/snes/test.sfc")).arrayBuffer()));
            for (const mode of variant === "baseline" ? ["baseline"] : ["fast", "debug"]) {
              if (variant !== "baseline") await sim._sim_mode(mode);
              const trials = [];
              for (let trial = 0; trial < 3; ++trial) {
                await sim._sim_reset();
                for (let i = 0; i < 4; ++i) await sim._sim_batch(16384);
                const started = performance.now();
                for (let i = 0; i < design.batches; ++i) await sim._sim_batch(16384);
                const ms = performance.now() - started;
                trials.push({ ms, clocksPerSecond: design.batches * 16384 * 1000 / ms });
              }
              measurements.push({ mode, compile: sim.metrics, trials });
            }
          } finally { sim._sim_destroy(); }
        }
        return { design: design.name, batchCycles: 16384, batches: design.batches, measurements };
      }, design));
      console.log(JSON.stringify(results.at(-1)));
    }
    const report = { baseline: ref, date: new Date().toISOString(), browser: browser.version(),
      platform: `${process.platform}/${process.arch}`, methodology: "Three warmed, sequential direct-worker trials; identical batch sizes; wall time includes worker transfer and media copying, excludes UI timers/pacing; Debug has no selected history or breakpoint.", results };
    writeFileSync(".build/mode-benchmark.json", JSON.stringify(report, null, 2) + "\n");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
