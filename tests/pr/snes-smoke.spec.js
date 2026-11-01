const { test, expect } = require("@playwright/test");
const { readFileSync, writeFileSync } = require("node:fs");
const { snesTitle } = require("../pr-selection.cjs");

// A separate bounded observation, not a shortened comprehensive fixture loop.
// Compile the unmodified console through the production browser compiler and
// drive its real cartridge, CPU, PPU, APU and controller via the production worker.
test(snesTitle, { annotation: { type: "cartridges", description: "test.sfc" } }, async ({ page }, info) => {
  test.setTimeout(500_000);
  await page.goto("./");
  page.on("console", (message) => {
    if (/^(SNES smoke|Loading browser|Compiling)/.test(message.text())) console.log(message.text());
  });
  const result = await page.evaluate(async (cartridge) => {
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
      const compiled = await new Promise((resolve, reject) => {
        compiler.onmessage = ({ data }) => {
          if (data.error) reject(new Error(data.error));
          if (data.progress && !data.progress.includes("%")) console.log(data.progress);
          if (data.wasm) resolve(data);
        };
        compiler.onerror = (event) => reject(new Error(event.message));
        compiler.postMessage({ files, top: "snes", frontend: "slang", board: "snes" });
      });
      console.log("SNES smoke compiled", JSON.stringify(compiled.metrics));
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
      async function observe(batches, buttons) {
        let frame, height, cycles, samples = 0, nmi = 0, irq = 0, hdma = 0;
        const pcm = [];
        for (let i = 0; i < batches; i++) {
          const output = await call({ action: "batch", batchCycles: 16384, buttons });
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
      await call({ action: "power-reset" });
      await load();
      const replay = await prefix();
      return { idle, pressed, trace, replay, metrics: compiled.metrics,
        runtimeMs: performance.now() - started, wasm: Array.from(compiled.wasm) };
    } finally { compiler.terminate(); runtime.terminate(); }
  }, Array.from(readFileSync("examples/snes/test.sfc")));
  const { wasm, ...evidence } = result;
  writeFileSync(info.outputPath("snes.wasm"), Buffer.from(wasm));
  writeFileSync(info.outputPath("snes-smoke.json"), JSON.stringify(evidence));
  console.log("SNES smoke phases", JSON.stringify({ ...result.metrics, runtimeMs: result.runtimeMs }));
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
});
