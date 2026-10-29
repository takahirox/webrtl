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
cases += [(f'depth-{mode}',dict(mode=mode,effect='depth')) for mode in range(7)]
cases += [(f'hires-{mode}-{bg}-{priority}-{stripe}',dict(mode=mode,effect=f'hires-{bg}-{priority}-{stripe}'))
 for mode,bg in [(5,'bg1'),(6,'bg1'),(5,'bg2')]
 for priority in ['low','high'] for stripe in ['normal','reverse']]
cases += [(f'bus-{bus}',dict(bus=bus)) for bus in ['no-sram-lorom','no-sram-hirom','sram-lorom','sram-hirom']]
cases += [(effect,dict(effect=effect)) for effect in ['bg2','bg3','bg4','layers','subscreen','scroll','mosaic','subtract','half',
 'priority-low','priority-high','window-or','window-and','window-xor','window-xnor']]
cases += [('rotate',dict(mode=7,effect='rotate'))]
cases += [(effect,dict(mode=7,effect=effect)) for effect in
 ['hflip','vflip','hvflip','hflip-fraction','hflip-scale','vflip-fraction','vflip-scale']]
cases += [(f'direct-{mode}',dict(mode=mode,effect='direct')) for mode in [3,4,7]]
cases += [(f'offset-{mode}',dict(mode=mode,effect='offset')) for mode in [2,4,6]]
cases += [(name,dict(mode=1,effect=name)) for name in ['bg3-priority-low','bg3-priority-high']]
cases += [(name,dict(sprite_priority=3,effect=name)) for name in ['sprite-hflip','sprite-vflip']]
cases += [('serial',dict(joycheck=0xa55)),('reverse',dict(transfer='reverse')),('indirect',dict(transfer='indirect'))]
cases += [(f'dma-{mode}',dict(transfer=f'mode{mode}')) for mode in range(8)]
cases += [(f'audio-{audio}',dict(audio=audio)) for audio in ['gain','mute','pitch','voices','adsr','ramp','keyoff','noise','echo','filter-1','filter-2','filter-3','range13','gauss-wrap','negative-modulator']]
cases += [('reject-mode5-as0',dict(mode=0))]
print(json.dumps([dict(name=name,bytes=list(build(**args)[0])) for name,args in cases]))`], { maxBuffer: 16 * 1024 * 1024 }));

test.setTimeout(1_200_000);

// Expected pixels are specified from the cartridge data and SNES dot/bitplane,
// transparency, layer and color arithmetic rules, never captured from the RTL.
// See docs/snes-fixtures.md for register values and independent references.
function pixel(name, x, y) {
  if (name === "reject-mode5-as0") name = "mode-5";
  const blue = [0, 0, 255, 255], red = [255, 0, 0, 255], green = [0, 255, 0, 255];
  const hires = ["mode-5", "mode-6", "depth-5", "depth-6"].includes(name);
  let dot = hires ? x : x >> 1;
  if (name.startsWith("hires-")) return (x & 1) ^ Number(name.endsWith("reverse")) ? red : blue;
  if (name.includes("flip") && !name.startsWith("sprite-")) {
    // bsnes Mode 7: flip unsigned screen coordinates before signed 8.8
    // matrix multiplication; the vertical product discards six low bits.
    const scale = name.endsWith("fraction") ? 1 : name.endsWith("scale") ? 0x81 : 0x100;
    const sourceX = name.startsWith("vflip") ? ((scale * (255 - (y + 1))) & ~63) >> 8 :
      (scale * (255 - dot)) >> 8;
    return sourceX & 1 ? red : blue;
  }
  if (name.startsWith("offset-")) return ((y + 1 + Number(x >= 16)) & 1) ? red : blue;
  if (name.startsWith("depth-")) {
    const mode = Number(name.at(-1));
    const bpp = mode === 0 ? 2 : [1, 2, 5, 6].includes(mode) ? 4 : 8;
    const index = (dot & 3) + (bpp >= 4 ? dot & 4 : 0) + (bpp === 8 ? 16 : 0);
    const expand = (n) => (n << 3) | (n >> 2);
    return index === 0 ? blue : index === 1 ? red :
      [expand(index & 31), expand(index * 3 & 31), expand(index * 7 & 31), 255];
  }
  if (name === "scroll") dot++;
  if (name === "mosaic" || name === "zoom") return blue;
  if (name === "constant") return red;
  if (name === "rotate") return (y + 1) & 1 ? red : blue;
  if (name === "window" && dot >= 64 && dot <= 127) return blue;
  if (name.startsWith("window-")) {
    const a = dot >= 64 && dot <= 127, b = dot >= 96 && dot <= 159;
    const mask = { "window-or": a || b, "window-and": a && b,
      "window-xor": a !== b, "window-xnor": a === b }[name];
    if (mask) return blue;
  }
  if (["sprite-low", "sprite-high"].includes(name) && dot >= 16 && dot < 24 && y >= 16 && y < 24 &&
      (name === "sprite-high" || !(dot & 1))) return green;
  if (["sprite-hflip", "sprite-vflip"].includes(name) && dot >= 16 && dot < 24 && y >= 16 && y < 24) {
    const spriteX = name === "sprite-hflip" ? 7 - ((y - 16) >> 1) : (23 - y) >> 1;
    if (dot - 16 === spriteX) return green;
  }
  if (name === "layers" && !(dot & 1)) return green;
  if (!(dot & 1)) return blue;
  if (name.startsWith("direct-")) return [33, 0, 0, 255];
  return ({ auto: green, serial: green, bg2: green, "priority-high": green, "bg3-priority-high": green, bg3: [255, 255, 0, 255],
    bg4: [0, 255, 255, 255], math: [255, 255, 0, 255],
    subscreen: [255, 255, 0, 255], subtract: [132, 0, 0, 255], half: [189, 0, 0, 255] })[name] || red;
}

// An independent, restricted DSP oracle for these original BRR fixtures.
// Only Gaussian phases 0 and 1/2 are needed. Coefficients and truncation rules
// are cross-checked with snes_spc (see docs/snes-fixtures.md), not the RTL tables.
function expectedPcm(name) {
  if (["audio-mute", "audio-keyoff"].includes(name)) return [0];
  const env = name === "audio-gain" ? 0x400 : name === "audio-ramp" ? 0x7ff :
    name === "audio-adsr" ? 0x7ff : 0x7f0;
  const volume = (sample) => {
    const voice = ((sample * env) >> 11) & ~1;
    return name === "audio-voices" ? ((8 * ((voice * 16) >> 7)) * 127) >> 7 :
      ((((voice * 127) >> 7) * 127) >> 7);
  };
  if (name === "audio-noise") {
    const wave = [];
    let state = 0x4000;
    do {
      wave.push(volume((state << 17) >> 16));
      state = (state >> 1) | (((state ^ (state >> 1)) & 1) << 14);
    } while (state !== 0x4000);
    return wave;
  }
  let decoded = Array.from({ length: 16 }, (_, i) => (i < 8 ? 7 : -7) << 11);
  if (name === "audio-range13") decoded = decoded.map((v) => v < 0 ? -4096 : 0);
  if (name === "audio-gauss-wrap") decoded.fill(-32768);
  if (name.startsWith("audio-filter-")) {
    const filter = Number(name.at(-1));
    let previous = 0, older = 0;
    const samples = [], seen = new Map();
    for (let i = 0; i < 100000; i++) {
      let value = (i % 16 < 8 ? 7 : -7) << 3;
      if (filter === 1) value += (previous >> 1) + ((-previous) >> 5);
      if (filter === 2) value += previous - (older >> 1) + (older >> 5) + ((-3 * previous) >> 6);
      if (filter === 3) value += previous - (older >> 1) + ((-13 * previous) >> 7) + ((3 * (older >> 1)) >> 4);
      value = (Math.max(-32768, Math.min(32767, value)) << 17) >> 16;
      older = previous; previous = value; samples.push(value);
      if (i % 16 === 15) {
        const state = `${previous},${older}`;
        if (seen.has(state)) { decoded = samples.slice(seen.get(state)); break; }
        seen.set(state, samples.length);
      }
    }
  }
  const square = (i) => decoded[i % decoded.length];
  // snes_spc V3c: constant voice 0's Gaussian output is -14344; applying
  // direct gain $7f produces -14232. Signed PMON changes $0e27 to $0800.
  const modulator = ((-14344 * 0x7f0) >> 11) & ~1;
  const pitch = name === "audio-negative-modulator" ? 0x0e27 + (((modulator >> 5) * 0x0e27) >> 10) :
    name === "audio-pitch" ? 0x0800 : 0x1000;
  const wave = Array.from({ length: pitch === 0x0800 ? 32 : decoded.length }, (_, n) => {
    const pos = n * pitch / 0x1000;
    const coefficients = pos % 1 ? [56, 965, 969, 58] : [370, 1305, 374, 0];
    const terms = coefficients.map((c, i) => (square(Math.floor(pos) + i) * c) >> 11);
    const partial = ((terms[0] + terms[1] + terms[2]) << 16) >> 16;
    return Math.max(-32768, Math.min(32767, partial + terms[3])) & ~1;
  });
  if (name === "audio-echo") {
    // EDL=1: 512 stereo samples; FIR tap 0 reads seven samples back.
    // No feedback. FIR=$40, EVOL=$40, EON=1, echo writes clear bit 0.
    const voice = wave.map((s) => (((s * env) >> 11) & ~1) * 127 >> 7);
    return voice.map((v, i) => ((v * 127) >> 7) +
      ((((voice[(i + 16 - 7) % 16] & ~1) >> 1) & ~1) >> 1));
  }
  return wave.map(volume);
}

function pcmMatches(actual, expected) {
  return expected.some((_, phase) => actual.every((sample, i) => sample === expected[(phase + i) % expected.length]));
}

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
  const results = await page.evaluate(async ({ cartridge, modeCartridges, pixelSource }) => {
    const expectedPixel = new Function(`return (${pixelSource})`)();
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
      for (let i = 0; i < 64 + 100; ++i) {
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
        elapsedMs: performance.now() - start, cycles: 64 * 512 + 100 * 16384 };
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
        const trace = [], pcm = [], hdma = [];
        for (let i = 0; i < (fixture.name === "interlace" ? 224 : 164); i++) {
          const output = await call({ action: "batch", batchCycles: i < 64 ? 512 : 16384,
            buttons: fixture.name === "auto" ? 2048 : fixture.name === "serial" ? 0xa55 : 0 });
          if (output.frame) { frame = output.frame; height = output.height; }
          if (output.audio) pcm.push(...output.audio);
          if (i < 64) trace.push(...output.trace);
          for (let j = 0; j < output.trace.length; j += 4) {
            const [cycle, address, value, flags] = output.trace.slice(j, j + 4);
            if (cycle > 1000000 && address === 0x2121 && (flags & 1)) hdma.push([cycle, value]);
          }
        }
        let mismatches = 0;
        const examples = [];
        for (let y = 0; y < height; y++) for (let x = 0; x < 512; x++) {
          const offset = (y * 512 + x) * 4, expected = expectedPixel(fixture.name, x, y);
          if (expected.some((v, i) => v !== frame[offset + i])) {
            mismatches++;
            if (examples.length < 4) examples.push({ x, y, actual: Array.from(frame.slice(offset, offset + 4)), expected });
          }
        }
        const onset = pcm.findIndex((sample) => sample !== 0);
        modeResults.push({ name: fixture.name, height, mismatches, examples,
          trace, pcm: pcm.slice(-256), onset: pcm.slice(onset, onset + 768), hdma });
      }
      return { first, repeat, hi, modeResults, metrics: window.compiled.metrics,
        validWasm: WebAssembly.validate(window.compiled.wasm) };
    } finally { worker.terminate(); }
  }, { cartridge: Array.from(rom), modeCartridges: modes, pixelSource: pixel.toString() });
  writeFileSync(info.outputPath("snes-fixture-results.json"), JSON.stringify(results.modeResults));
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
  const fixtureEvidence = [];
  for (const { name, height, mismatches, examples, trace, pcm, onset, hdma } of results.modeResults) {
    fixtureEvidence.push({ name, height, mismatches, examples, pcm: pcm.slice(0, 32), hdma });
    if (name.startsWith("reject-")) expect(mismatches, name).toBeGreaterThan(50000);
    else expect.soft({ mismatches, examples }, name).toEqual({ mismatches: 0, examples: [] });
    expect(pcm.length, `${name} retains the PCM sample clock`).toBe(256);
    expect.soft(pcmMatches(pcm, expectedPcm(name)), `${name} independently calculated PCM`).toBe(true);
    if (name === "audio-ramp") {
      expect(Math.max(...onset.slice(0, 16).map(Math.abs))).toBeLessThan(6000);
      expect(Math.max(...onset.slice(64, 96).map(Math.abs))).toBeGreaterThan(13000);
    }
    if (name === "audio-adsr") expect(Math.max(...onset.slice(0, 16).map(Math.abs))).toBeGreaterThan(13000);
    if (name === "audio-keyoff") expect(onset.filter((sample) => sample !== 0).length).toBeGreaterThan(10);
    if (name === "audio-echo") {
      expect(onset.length).toBe(768);
      expect(pcmMatches(onset.slice(64, 500), expectedPcm("mode-0")), "echo's 512-sample delay").toBe(true);
      expect(pcmMatches(onset.slice(600, 768), expectedPcm("audio-echo"))).toBe(true);
    }
    expect(height, name).toBe(name === "interlace" ? 448 : name === "overscan" ? 239 : 224);
    const writes = Array.from({ length: trace.length / 4 }, (_, i) => trace.slice(i * 4, i * 4 + 4)).filter((t) => t[3] & 1);
    if (name === "serial") {
      expect(writes.filter((t) => t[1] >= 0x7e2000 && t[1] < 0x7e2018).map((t) => t[2])).toEqual(
        Array.from({ length: 24 }, (_, i) => i < 12 ? (0xa55 >> (11 - i)) & 1 : Number(i >= 16)));
    }
    if (name.startsWith("bus-")) {
      const hirom = name.endsWith("hirom"), sram = name.startsWith("bus-sram-");
      const expected = [0x60, 0x50, 0x80,
        ...(!hirom && !sram ? [0x70, 0xf0] : []),
        ...Array(hirom ? 4 : 6).fill(0xa6), ...(sram ? [0x5a, 0x3c] : [])];
      expect(writes.filter((t) => t[1] >= 0x7e3100 && t[1] < 0x7e3100 + expected.length)
        .map((t) => [t[1], t[2]]), `${name} CPU read results`).toEqual(
          expected.map((value, i) => [0x7e3100 + i, value]));
    }
    if (name.startsWith("dma-")) {
      const offsets = [[0], [0, 1], [0, 0], [0, 0, 1, 1], [0, 1, 2, 3], [0, 1, 0, 1], [0, 0], [0, 0, 1, 1]][Number(name.at(-1))];
      expect(writes.filter((t) => t[2] >= 0x21 && t[2] <= 0x28 && t[1] >= 0x210d && t[1] <= 0x2114)
        .map((t) => [t[1], t[2]]), name).toEqual(Array.from({ length: 8 }, (_, i) => [0x210d + offsets[i % offsets.length], 0x21 + i]));
    }
    if (name === "reverse") expect(writes.filter((t) => t[1] >= 0x7e3000 && t[1] < 0x7e3010)
      .map((t) => t[2])).toEqual(Array.from({ length: 16 }, (_, i) => i & 1 ? 0 : 0x55));
    if (name === "indirect") {
      const transfers = hdma.filter(([, value]) => value === 0x10 || value === 0x20);
      expect(transfers.length).toBeGreaterThanOrEqual(2);
      expect(transfers.map(([, value]) => value)).toEqual(transfers.map((_, i) => i % 2 ? 0x20 : 0x10));
      // The CPU finishes its current 6/8-clock bus cycle, then DMA aligns
      // to its eight-clock divider. Check the 127-line spacing with at most
      // 16 master clocks of arbitration phase, not identical write phases.
      expect(transfers.every(([cycle, value], i) => value !== 0x20 ||
        Math.abs(cycle - transfers[i - 1][0] - 127 * 1364) <= 16)).toBe(true);
    }
  }
  await info.attach("snes-fixtures", { body: JSON.stringify(fixtureEvidence, null, 2), contentType: "application/json" });
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
