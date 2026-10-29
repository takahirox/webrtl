const { test, expect } = require("@playwright/test");
const { readFileSync, writeFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const rom = readFileSync("examples/snes/test.sfc");
const modes = JSON.parse(execFileSync("python3", ["-c", `import json,runpy
build=runpy.run_path('scripts/generate-snes-rom.py')['build']
cases=[(f'mode-{mode}',dict(mode=mode)) for mode in range(8)]
cases += [('sprite-low',dict(sprite_priority=0)),('sprite-high',dict(sprite_priority=3)),
 ('overscan',dict(display=4)),('interlace',dict(display=1)),('window',dict(effect='window')),
 ('math',dict(effect='math')),('zoom',dict(mode=7,effect='zoom')),
 ('constant',dict(mode=7,effect='constant')),('auto',dict(autojoy=True))]
print(json.dumps([dict(name=name,bytes=list(build(**args)[0])) for name,args in cases]))`], { maxBuffer: 4 * 1024 * 1024 }));

test.setTimeout(600_000);

// Independent image specification: tile 0 is eight rows of plane0=$55,
// plane1=$00, palette 0=blue, 1=red (green when B is held). Low-res dots
// occupy two samples of the fixed 512-wide capture raster.
function expectedFrame(green = false) {
  const data = [];
  for (let y = 0; y < 224; ++y) for (let x = 0; x < 512; ++x) {
    data.push(...((x >> 1) & 1 ? (green ? [0, 255, 0, 255] : [255, 0, 0, 255]) : [0, 0, 255, 255]));
  }
  return data;
}

async function canvasFrame(page) {
  return page.locator("#video").evaluate((c) => Array.from(c.getContext("2d").getImageData(0, 0, c.width, c.height).data));
}

async function frameMismatch(page, green = false) {
  return page.locator("#video").evaluate((c, green) => {
    if (c.width !== 512 || c.height !== 224) return -1;
    const frame = c.getContext("2d").getImageData(0, 0, 512, 224).data;
    let mismatches = 0;
    for (let y = 0; y < 224; y++) for (let x = 0; x < 512; x++) {
      const offset = (y * 512 + x) * 4;
      const color = (x >> 1) & 1 ? (green ? [0, 255, 0] : [255, 0, 0]) : [0, 0, 255];
      if (frame[offset] !== color[0] || frame[offset + 1] !== color[1] ||
          frame[offset + 2] !== color[2] || frame[offset + 3] !== 255) mismatches++;
    }
    return mismatches;
  }, green);
}

test("full SNES RTL boots a local cartridge, renders DMA tiles, produces DSP PCM, handles input and repeats reset", async ({ page }, info) => {
  const requests = [];
  page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));
  await page.addInitScript(() => {
    window.compiled = null;
    window.nonzeroPcm = 0;
    window.frameHash = (frame) => frame.reduce((sum, value) => ((sum ^ value) * 16777619) >>> 0, 2166136261);
    navigator.getGamepads = () => window.testGamepads || [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.wasm) window.compiled = { wasm: data.wasm.slice(), metrics: data.metrics };
          if (data.audio) window.nonzeroPcm += data.audio.filter((sample) => sample !== 0).length;
        });
      }
    };
  });
  await page.goto(process.env.WEBRTL_PUBLIC_URL || "./");
  await page.locator("#example").selectOption("snes");
  await page.locator("#load-example").click();
  await expect(page.locator("#top")).toHaveValue("snes");
  await expect(page.locator("#frontend")).toHaveValue("slang");
  await expect(page.locator("#files option")).toHaveCount(2);
  await page.locator("#compile").click();
  await expect(page.locator("#compile")).toBeEnabled({ timeout: 300000 });
  await expect(page.locator("#errors")).toBeHidden();
  console.log("SNES compiled", await page.evaluate(() => window.compiled.metrics));
  writeFileSync(info.outputPath("snes.wasm"), Buffer.from(await page.evaluate(() => Array.from(window.compiled.wasm))));
  await expect(page.locator("#run")).toBeDisabled();
  await page.locator("#cartridge").setInputFiles({ name: "original.sfc", mimeType: "application/octet-stream", buffer: rom });
  await expect(page.locator("#cartridge-status")).toContainText("loaded locally");
  console.log("SNES cartridge loaded");
  await page.locator("#run").click();
  await expect.poll(() => frameMismatch(page), { timeout: 45000, intervals: [500] }).toBe(0);
  console.log("SNES red frame verified");
  await expect.poll(() => page.evaluate(() => window.nonzeroPcm)).toBeGreaterThan(100);
  await page.locator("#video").focus();
  await page.keyboard.down("z");
  await expect.poll(() => frameMismatch(page, true), { timeout: 30000, intervals: [500] }).toBe(0);
  await page.keyboard.up("z");
  await expect.poll(() => frameMismatch(page), { timeout: 30000, intervals: [500] }).toBe(0);
  await page.evaluate(() => {
    window.testGamepads = [{ mapping: "standard", axes: [0, 0], buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === 0 })) }];
  });
  await expect.poll(() => frameMismatch(page, true), { timeout: 30000, intervals: [500] }).toBe(0);
  await page.locator("#pause").click();
  const stopped = await canvasFrame(page);
  await page.waitForTimeout(200);
  expect(await canvasFrame(page)).toEqual(stopped);
  await page.locator("#reset").click();
  await expect(page.locator("#step")).toBeEnabled();
  await expect(page.locator("#timing")).toContainText("0 cycles");

  // Reuse the newly browser-compiled circuit in an independent runtime worker.
  // Small startup batches retain the whole CPU/DMA bus trace. No test emulates
  // instructions, graphics or DSP operations.
  const results = await page.evaluate(async ({ cartridge, modeCartridges }) => {
    const worker = new Worker("./simulator-worker.js", { type: "module" });
    let id = 0;
    const call = (message) => new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage({ id: id++, board: "snes", ...message });
    });
    async function load(bytes) {
      await call({ action: "power-reset" });
      await call({ action: "cartridge", cartridge: bytes });
      for (let offset = 0; offset < bytes.length; offset += 16384) {
        await call({ action: "cartridge-chunk", offset, bytes: bytes.slice(offset, offset + 16384) });
      }
      await call({ action: "reset" });
    }
    async function run() {
      let samples = 0, nonzero = 0, pcmHash = 2166136261;
      let hdmaWrites = 0, nmiVectors = 0, irqVectors = 0;
      let memoryBytes = 0;
      const tail = [];
      const hashes = [], frameCycles = [], trace = [];
      const start = performance.now();
      for (let i = 0; i < 64 + 80; ++i) {
        const data = await call({ action: "batch", batchCycles: i < 64 ? 512 : 16384 });
        memoryBytes = Math.max(memoryBytes, data.memoryBytes);
        if (i < 64) trace.push(...data.trace);
        for (let j = 0; j < data.trace.length; j += 4) {
          const [cycle, address, value, flags] = data.trace.slice(j, j + 4);
          if (cycle > 500000 && address === 0x2121 && value === 0 && (flags & 1)) hdmaWrites++;
          if (address === 0xffea && !(flags & 1)) nmiVectors++;
          if (address === 0xffee && !(flags & 1)) irqVectors++;
        }
        if (data.audio) for (const sample of data.audio) {
          samples++; if (sample) nonzero++;
          pcmHash = Math.imul(pcmHash ^ (sample & 65535), 16777619) >>> 0;
          tail.push(sample); if (tail.length > 256) tail.shift();
        }
        if (data.frame) { hashes.push(frameHash(data.frame)); frameCycles.push(data.cycles); }
      }
      return { samples, nonzero, pcmHash, hashes, frameCycles, trace, hdmaWrites, nmiVectors, irqVectors,
        memoryBytes, pcmPeriod16: tail.every((value, i) => value === tail[i % 16]),
        pcmMin: Math.min(...tail), pcmMax: Math.max(...tail),
        elapsedMs: performance.now() - start, cycles: 64 * 512 + 80 * 16384 };
    }
    try {
      await call({ action: "init", wasm: window.compiled.wasm });
      await load(new Uint8Array(cartridge));
      const first = await run();
      await load(new Uint8Array(cartridge));
      const repeat = await run();
      // HiROM uses the same instructions at CPU $008000 and ROM offset $8000.
      const hirom = new Uint8Array(65536);
      hirom.set(new Uint8Array(cartridge), 32768);
      hirom[0xffd5] = 0x21; hirom[0xffd7] = 6;
      await load(hirom);
      const hi = await run();
      const modeResults = [];
      for (const fixture of modeCartridges) {
        await load(new Uint8Array(fixture.bytes));
        let frame, height;
        for (let i = 0; i < (fixture.name === "interlace" ? 120 : 70); i++) {
          const output = await call({ action: "batch", batchCycles: 16384, buttons: fixture.name === "auto" ? 2048 : 0 });
          if (output.frame) { frame = output.frame; height = output.height; }
        }
        const colors = {};
        for (let i = 0; i < frame.length; i += 4) {
          const key = Array.from(frame.slice(i, i + 4)).join(",");
          colors[key] = (colors[key] || 0) + 1;
        }
        modeResults.push({ name: fixture.name, height, colors });
      }
      return { first, repeat, hi, modeResults, metrics: window.compiled.metrics,
        validWasm: WebAssembly.validate(window.compiled.wasm) };
    } finally { worker.terminate(); }
  }, { cartridge: Array.from(rom), modeCartridges: modes });
  expect(results.validWasm).toBe(true);
  expect(results.first.nonzero).toBeGreaterThan(500);
  expect(results.first.hdmaWrites).toBeGreaterThanOrEqual(2);
  expect(results.first.nmiVectors).toBeGreaterThanOrEqual(2);
  expect(results.first.irqVectors).toBeGreaterThan(100);
  expect(results.first.pcmPeriod16).toBe(true); // pitch $1000: 16-sample BRR period -> 2 kHz at 32 kHz
  expect(results.first.pcmMin).toBeLessThan(0);
  expect(results.first.pcmMax).toBeGreaterThan(0);
  expect(Math.abs(results.first.samples - results.first.cycles * 32000 / 21477270)).toBeLessThan(2);
  expect(results.repeat.pcmHash).toBe(results.first.pcmHash);
  expect(results.repeat.hashes).toEqual(results.first.hashes);
  expect(results.repeat.trace).toEqual(results.first.trace);
  expect(results.hi.hashes.at(-1)).toEqual(results.first.hashes.at(-1));
  expect(results.hi.nonzero).toBeGreaterThan(500);
  for (const { name, height, colors } of results.modeResults) {
    const expected = {
      "sprite-low": { "0,0,255,255": 57280, "255,0,0,255": 57344, "0,255,0,255": 64 },
      "sprite-high": { "0,0,255,255": 57280, "255,0,0,255": 57280, "0,255,0,255": 128 },
      overscan: { "0,0,255,255": 61184, "255,0,0,255": 61184 },
      interlace: { "0,0,255,255": 114688, "255,0,0,255": 114688 },
      window: { "0,0,255,255": 71680, "255,0,0,255": 43008 },
      math: { "0,0,255,255": 57344, "255,255,0,255": 57344 },
      zoom: { "0,0,255,255": 114688 }, constant: { "255,0,0,255": 114688 },
      auto: { "0,0,255,255": 57344, "0,255,0,255": 57344 },
    }[name] || { "0,0,255,255": 57344, "255,0,0,255": 57344 };
    expect(colors, name).toEqual(expected);
    expect(height, name).toBe(name === "interlace" ? 448 : name === "overscan" ? 239 : 224);
  }
  expect(results.first.hashes.at(-1)).toBe(await page.evaluate((data) => frameHash(data), expectedFrame()));
  const transactions = Array.from({ length: results.first.trace.length / 4 }, (_, i) => results.first.trace.slice(i * 4, i * 4 + 4));
  expect(transactions.some(([, address]) => address === 0xfffc)).toBe(true);
  expect(transactions.some(([, address, data, flags]) => address === 0x7e001e && data === 1 && (flags & 1))).toBe(true);
  const dma = transactions.filter(([, address, , flags]) => [0x2118, 0x2119].includes(address) && (flags & 1));
  expect(dma.map(([, address, data]) => [address, data])).toEqual(Array.from({ length: 16 }, (_, i) => [i % 2 ? 0x2119 : 0x2118, i % 2 ? 0 : 0x55]));
  expect(requests.every((r) => r.method === "GET" && new URL(r.url).origin === new URL(page.url()).origin)).toBe(true);
  console.log("SNES measurements", JSON.stringify({ browser: info.project.name, ...results.metrics,
    runtime: { ...results.first, trace: undefined } }));
  await info.attach("snes-measurements", { body: JSON.stringify({ browser: info.project.name,
    ...results.metrics, runtime: { ...results.first, trace: undefined } }, null, 2), contentType: "application/json" });
});

test("Slang remains a general-purpose frontend and cartridge validation rejects unsupported layouts", async ({ page }) => {
  await page.goto("./");
  await page.locator("#frontend").selectOption("slang");
  await page.locator("#source").fill(`module counter(input clk, reset, output reg [7:0] count);
    localparam logic [7:0] values [0:1] = '{8'd3,8'd7};
    always @(posedge clk) if(reset) count<=0; else count<=count+values[0];
  endmodule`);
  await page.locator("#compile").click();
  await expect(page.locator("#step")).toBeEnabled({ timeout: 300000 });
  await page.locator("#step").click();
  await expect(page.locator("#count")).toHaveText("3");
  const validation = await page.evaluate(async (data) => {
    const { parseCartridge } = await import("./snes-rom.js");
    const bytes = new Uint8Array(data);
    const padded = new Uint8Array(bytes.length + 512); padded.set(bytes, 512);
    const rejects = [];
    for (const input of [new Uint8Array(32), new Uint8Array(65537), new Uint8Array(8388608),
      bytes.map((v, i) => i === 0x7fd6 ? 0x13 : v), bytes.map((v, i) => i === 0x7fd8 ? 8 : v)]) {
      try { parseCartridge(input); rejects.push(false); } catch { rejects.push(true); }
    }
    const p = parseCartridge(padded);
    return { rejects, size: p.bytes.length, mask: p.mask, hirom: p.hirom };
  }, Array.from(rom));
  expect(validation).toEqual({ rejects: [true, true, true, true, true], size: 32768, mask: 32767, hirom: false });
});
