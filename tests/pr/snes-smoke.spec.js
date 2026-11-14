const { test, expect } = require("../pr-profile.cjs");
const { readFileSync, writeFileSync, appendFileSync } = require("node:fs");
const { snesTitle } = require("../pr-selection.cjs");
const { execFileSync } = require("node:child_process");
const { cacheIdentity, loadCircuit, saveCircuit } = require("../pr-circuit-cache.cjs");

// A separate bounded observation, not a shortened comprehensive fixture loop.
// Compile the unmodified console through the production browser compiler and
// drive its real cartridge, CPU, PPU, APU and controller via the production worker.
test(snesTitle, { annotation: { type: "cartridges", description: "test.sfc" } }, async ({ page, browser }, info) => {
  test.setTimeout(500_000);
  const identity = cacheIdentity(browser.version());
  const directory = `.build/pr-snes-cache/${identity}`;
  const cached = loadCircuit(directory, identity);
  await page.goto("./");
  page.on("console", (message) => {
    if (/^(SNES smoke|Loading browser|Compiling)/.test(message.text())) console.log(message.text());
  });
  const result = await page.evaluate(async ({ cartridge, cached }) => {
    const compiler = new Worker("./compiler-worker.js", { type: "module" });
    const runtime = new Worker("./simulator-worker.js", { type: "module" });
    let id = 0;
    const call = (message) => new Promise((resolve, reject) => {
      runtime.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
      runtime.onerror = (event) => reject(new Error(event.message));
      runtime.postMessage({ id: id++, board: "snes", ...message });
    });
    try {
      const files = Object.fromEntries(await Promise.all(["snes.v", "snes-core.v"].map(async (name) => {
        const response = await fetch(`./examples/snes/${name}`);
        if (!response.ok) throw new Error(`Missing SNES source: ${name}`);
        return [name, await response.text()];
      })));
      const compileStarted = performance.now();
      const compiled = cached ? { ...cached, wasm: new Uint8Array(cached.wasm) } : await new Promise((resolve, reject) => {
        compiler.onmessage = ({ data }) => {
          if (data.error) reject(new Error(data.error));
          if (data.progress && !data.progress.includes("%")) console.log(data.progress);
          if (data.wasm) resolve(data);
        };
        compiler.onerror = (event) => reject(new Error(event.message));
        compiler.postMessage({ files, top: "snes", frontend: "slang", board: "snes" });
      });
      const compileMs = performance.now() - compileStarted;
      if (!compiled.metrics.fastBackend.supported) throw new Error(`SNES unexpectedly fell back: ${compiled.metrics.fastBackend.reason}`);
      console.log("SNES smoke compilation", JSON.stringify({ compilation: cached ? "reused" : "fresh",
        compileMs, originalMetrics: compiled.metrics }));
      const started = performance.now();
      const bytes = new Uint8Array(cartridge);
      async function load() {
        await call({ action: "cartridge", cartridge: bytes });
        for (let offset = 0; offset < bytes.length; offset += 16384) {
          await call({ action: "cartridge-chunk", offset, bytes: bytes.slice(offset, offset + 16384) });
        }
        await call({ action: "reset" });
        await call({ action: "mode", mode: "debug" });
      }
      await call({ action: "init", wasm: compiled.wasm });
      await load();
      async function prefix() {
        const trace = [];
        // Keep every startup bus transaction; large batches cap the trace.
        for (let i = 0; i < 64; i++) {
          const output = await call({ action: "batch", batchCycles: 512 });
          trace.push(...output.trace);
        }
        return trace;
      }
      const trace = await prefix();
      const deliveries = [];
      let replayIndex = 0;
      async function selectedState() {
        const { signals } = await call({ action: "mode", mode: "debug" });
        const registers = signals.filter((s) => s.type === 1);
        const refs = Array.from({ length: Math.min(32, registers.length) }, (_, i) =>
          ({ id: registers[Math.floor(i * (registers.length - 1) / 31)].id, row: 0 }));
        for (const memory of signals.filter((s) => s.depth > 1))
          for (const row of [0, Math.min(1, memory.depth - 1), memory.depth - 1]) refs.push({ id: memory.id, row });
        return (await call({ action: "inspect", refs })).values;
      }
      async function observe(batches, buttons, compare = false) {
        let frame, height, cycles, samples = 0, nmi = 0, irq = 0, hdma = 0;
        const pcm = [];
        for (let i = 0; i < batches; i++) {
          let output;
          if (compare && i === 1) {
            // Pause -> Debug -> Step -> Fast inside a measured media interval.
            const { snapshot } = await call({ action: "pause" });
            await call({ action: "mode", mode: "debug", snapshot });
            const step = await call({ action: "step", buttons });
            const paused = await call({ action: "pause" });
            await call({ action: "mode", mode: "fast", snapshot: paused.snapshot });
            output = await call({ action: "batch", batchCycles: 16383, buttons });
            output.audio = Int16Array.from([...(step.audio || []), ...(output.audio || [])]);
            if (!output.frame && step.frame) { output.frame = step.frame; output.height = step.height; }
          } else output = await call({ action: "batch", batchCycles: 16384, buttons });
          if (compare) {
            if (output.backend !== "scheduled") throw new Error("SNES Fast path silently fell back");
            const expected = deliveries[replayIndex++];
            for (const key of ["frame", "audio"]) {
              const actual = output[key] || [], wanted = expected[key] || [];
              if (actual.length !== wanted.length || actual.some((v, j) => v !== wanted[j]))
                throw new Error(`SNES ${key} timing/value mismatch at cycle ${output.cycles}`);
            }
            if (output.cycles !== expected.cycles || output.height !== expected.height) throw new Error("SNES clock/frame boundary mismatch");
          } else deliveries.push(output);
          cycles = output.cycles;
          if (output.frame) { frame = output.frame; height = output.height; }
          if (output.audio) { samples += output.audio.length; pcm.push(...output.audio); }
          for (let j = 0; j < output.trace.length; j += 4) {
            const [cycle, address, value, flags] = output.trace.slice(j, j + 4);
            if (address === 0xffea && !(flags & 1)) nmi++;
            if (address === 0xffee && !(flags & 1)) irq++;
            if (cycle > 500000 && address === 0x2121 && value === 0 && (flags & 1)) hdma++;
          }
        }
        // Independent cartridge tile/palette specification: plane0=$55,
        // blue background, red foreground (green after serial B input).
        const mismatches = (green) => {
          if (!frame || height !== 224) return -1;
          let count = 0;
          for (let y = 0; y < 224; y++) for (let x = 0; x < 512; x++) {
            const color = (x >> 1) & 1 ? (green ? [0, 255, 0, 255] : [255, 0, 0, 255]) : [0, 0, 255, 255];
            if (color.some((v, i) => frame[(y * 512 + x) * 4 + i] !== v)) count++;
          }
          return count;
        };
        return { cycles, samples, pcm: pcm.slice(-256), nmi, irq, hdma,
          mismatches: mismatches(Boolean(buttons)), wrongPalette: mismatches(!buttons) };
      }
      // Allow the real 1280-byte SPC700 upload/boot, then two frames with B.
      // Fixed caps fail if boot, DMA, DSP or serial input never produces output.
      const idle = await observe(100, 0);
      const pressed = await observe(48, 2048);
      const referenceState = await selectedState();
      await call({ action: "power-reset" });
      await load();
      const replay = await prefix();
      await call({ action: "mode", mode: "fast" });
      const fastIdle = await observe(100, 0, true);
      const fastPressed = await observe(48, 2048, true);
      const fastState = await selectedState();
      if (JSON.stringify(fastState) !== JSON.stringify(referenceState)) throw new Error("SNES selected register/RAM state differs across engine handoff");
      return { idle, pressed, fastIdle, fastPressed, comparedDeliveries: replayIndex, trace, replay, metrics: compiled.metrics,
        compileMs, compilation: cached ? "reused" : "fresh",
        runtimeMs: performance.now() - started, wasm: Array.from(compiled.wasm) };
    } finally { compiler.terminate(); runtime.terminate(); }
  }, { cartridge: Array.from(readFileSync("examples/snes/test.sfc")), cached });
  const { wasm, ...evidence } = result;
  expect(result.comparedDeliveries).toBe(148);
  expect(result.fastIdle.mismatches).toBe(0);
  expect(result.fastPressed.mismatches).toBe(0);
  writeFileSync(info.outputPath("snes.wasm"), Buffer.from(wasm));
  writeFileSync(info.outputPath("snes-smoke.json"), JSON.stringify({ ...evidence, identity, cachedSourceSha: cached?.sourceSha }));
  console.log("SNES smoke phases", JSON.stringify({ originalMetrics: result.metrics, compilation: result.compilation,
    compileMs: result.compileMs, runtimeMs: result.runtimeMs }));
  expect(WebAssembly.validate(Buffer.from(wasm))).toBe(true);
  expect(result.trace.length).toBeGreaterThan(100);
  expect(result.replay, "fresh-instance CPU bus startup replays exactly").toEqual(result.trace);
  for (const [name, observation, batches] of [["idle", result.idle, 100], ["B", result.pressed, 48]]) {
    expect(observation.mismatches, `${name}: all independently expected pixels`).toBe(0);
    expect(observation.wrongPalette, `${name}: rejects an incorrect palette`).toBe(512 * 224 / 2);
    expect(Math.abs(observation.samples - batches * 16384 * 32000 / 21477270), `${name}: DSP clock`).toBeLessThan(2);
    expect(observation.pcm).toHaveLength(256);
    expect(observation.nmi, `${name}: CPU handles vblank`).toBeGreaterThan(0);
    expect(observation.irq, `${name}: CPU handles raster IRQ`).toBeGreaterThan(0);
    expect(observation.hdma, `${name}: HDMA palette transfers`).toBeGreaterThan(0);
    // Independent BRR/Gaussian/direct-gain arithmetic, not recorded RTL output.
    const square = (i) => (i % 16 < 8 ? 7 : -7) << 11;
    const expected = Array.from({ length: 16 }, (_, n) => {
      const terms = [370, 1305, 374].map((c, i) => (square(n + i) * c) >> 11);
      const sample = ((terms.reduce((sum, v) => sum + v, 0) << 16) >> 16) & ~1;
      const voice = ((sample * 0x7f0) >> 11) & ~1;
      return ((((voice * 127) >> 7) * 127) >> 7);
    });
    expect(expected.some((_, phase) => observation.pcm.every((v, i) => v === expected[(phase + i) % 16])),
      `${name}: exact independent DSP PCM`).toBe(true);
  }
  if (!cached) saveCircuit(directory, identity, result,
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
  console.log("SNES compilation provenance", JSON.stringify({ identity, compilation: result.compilation,
    sourceSha: cached?.sourceSha || process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    compileMs: result.compileMs, runtimeMs: result.runtimeMs }));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `SNES compilation: ${result.compilation}, ${(result.compileMs / 1000).toFixed(3)}s; simulation ${(result.runtimeMs / 1000).toFixed(3)}s; identity ${identity}; generated at ${cached?.sourceSha || process.env.GITHUB_SHA || "local checkout"}. Original compiler phases: ${JSON.stringify(result.metrics.phases)}.\n`);
});
