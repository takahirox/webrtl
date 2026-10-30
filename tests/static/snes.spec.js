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
cases += [('sprite-edges',dict(sprite_priority=3,effect='sprite-edges')),
 ('sprite-interlace',dict(sprite_priority=3,display=3,effect='sprite-interlace')),
 ('sprite-interlace-vflip',dict(sprite_priority=3,display=3,effect='sprite-interlace-vflip')),
 ('sprite-rect',dict(sprite_priority=3,effect='sprite-rect')),
 ('sprite-rect-vflip',dict(sprite_priority=3,effect='sprite-rect-vflip')),
 ('cgram-latch',dict(effect='cgram-latch'))]
cases += [('serial',dict(joycheck=0xa55)),('reverse',dict(transfer='reverse')),('indirect',dict(transfer='indirect'))]
cases += [(f'dma-{mode}',dict(transfer=f'mode{mode}')) for mode in range(8)]
cases += [(f'audio-{audio}',dict(audio=audio)) for audio in ['gain','mute','pitch','voices','adsr','ramp','keyoff','noise','echo','echo-wrap','filter-1','filter-2','filter-3','range13','gauss-wrap','negative-modulator']]
cases += [(f'apu-{check}',dict(apu_check=check)) for check in
 ['timer-zero-0','timer-zero-1','timer-zero-2','aux','div-normal','div-overflow',
  'div-zero-divisor','div-nine-bit','div-boundary','div-zero-result','div-half-clear',
  'dsp-mirror-volume','dsp-mirror-flg','dsp-mirror-kon','endx']]
cases += [('apu-aux-repeat',dict(apu_check='aux'))]
cases += [(f'sprite-small-interlace-{size}{flip}',dict(sprite_priority=3,display=3,effect=f'sprite-small-interlace-{size}{flip}'))
 for size in [6,7] for flip in ['', '-vflip']]
cases += [(name,dict(mode=7,effect=name)) for name in ['m7-over2','m7-over3','m7-origin-positive','m7-origin-negative']]
cases += [(f'color-window-{clip}-{prevent}',dict(effect=f'color-window-{clip}-{prevent}'))
 for clip in range(4) for prevent in range(4)]
cases += [(name,dict(sprite_priority=3,effect=name)) for name in ['obj-limit-32','obj-limit-33','obj-limit-34tiles','obj-limit-35tiles']]
cases += [('multi',dict(transfer='multi'))]
cases += [(f'audio-{audio}',dict(audio=audio)) for audio in ['feedback','decay-sustain','sustain','adsr-release']]
cases += [('reject-mode5-as0',dict(mode=0))]
cases += [(name,dict(effect=name)) for name in ['slhv-latch','wbglog-open-bus']]
print(json.dumps([dict(name=name,bytes=list(build(**args)[0])) for name,args in cases]))`], { maxBuffer: 32 * 1024 * 1024 }));

// Optional focused reruns still exercise browser compilation and the baseline
// cartridge's input, audio, LoROM/HiROM and deterministic reset checks.
const selectedModes = process.env.WEBRTL_SNES_FIXTURES ?
  modes.filter(({ name }) => new RegExp(process.env.WEBRTL_SNES_FIXTURES).test(name)) : modes;
if (!selectedModes.length) throw new Error("WEBRTL_SNES_FIXTURES selected no cartridges");

// Bound each test to at most 20 cartridges plus the AUX reset comparison.
// Every batch compiles in the browser and retains baseline input/audio/reset
// checks. Keeping AUX and its repeat together preserves their cross-ROM check.
const fixtureBatches = [];
const batchModes = selectedModes.filter(({ name }) => name !== "apu-aux-repeat");
for (let offset = 0; offset < batchModes.length; offset += 20) {
  fixtureBatches.push(batchModes.slice(offset, offset + 20));
}
const auxRepeat = selectedModes.find(({ name }) => name === "apu-aux-repeat");
if (auxRepeat) {
  const batch = fixtureBatches.find((fixtures) => fixtures.some(({ name }) => name === "apu-aux"));
  if (batch) batch.push(auxRepeat);
  else fixtureBatches.push([auxRepeat]);
}

// Expected pixels are specified from the cartridge data and SNES dot/bitplane,
// transparency, layer and color arithmetic rules, never captured from the RTL.
// See docs/snes-fixtures.md for register values and independent references.
function pixel(name, x, y) {
  if (name === "reject-mode5-as0") name = "mode-5";
  const blue = [0, 0, 255, 255], red = [255, 0, 0, 255], green = [0, 255, 0, 255];
  const hires = ["mode-5", "mode-6", "depth-5", "depth-6"].includes(name);
  let dot = hires ? x : x >> 1;
  if (name.startsWith("color-window-")) {
    const [clip, prevent] = name.split("-").slice(-2).map(Number);
    const inside = dot >= 64 && dot <= 127;
    const disabled = (mode) => mode === 3 || (mode === 1 && !inside) || (mode === 2 && inside);
    const base = disabled(clip) ? [0, 0, 0, 255] : dot & 1 ? red : blue;
    return disabled(prevent) ? base : [base[0], 255, base[2], 255];
  }
  if (name === "m7-over2" || name === "m7-over3") {
    if (dot < 8) return green; // map tile 1
    return name === "m7-over2" ? blue : dot & 1 ? red : blue; // transparent vs tile 0
  }
  if (name.startsWith("m7-origin-")) {
    // Signed 13-bit offset-center differences are clipped to signed ten bits
    // before 8.8 matrix products; each origin product discards six low bits.
    const sign = name.endsWith("positive") ? 1 : -1;
    const clip = (n) => n & 0x2000 ? n | ~1023 : n & 1023;
    const origin = ((0x81 * clip(sign * 1025)) & ~63) +
      ((0x60 * clip(-sign * 1025)) & ~63) + ((0x60 * (y + 1)) & ~63) + (3 << 8);
    const sourceX = (origin + 0x81 * dot) >> 8;
    return [green, red, blue, red, blue, red, blue, [255, 255, 255, 255]][sourceX & 7];
  }
  if (name.startsWith("sprite-small-interlace-") && dot >= 16 && dot < 32) {
    const top = name.endsWith("-vflip") ? 40 : 32;
    if (y >= top && y < top + 8) return (y & 1) ^ Number(name.endsWith("-vflip")) ? [255, 255, 255, 255] : green;
  }
  if (name.startsWith("obj-limit-")) {
    const tiled = name.endsWith("tiles");
    if (dot >= 16 && dot < 16 + (tiled ? 16 : 8) && y >= 16 && y < 16 + (tiled ? 16 : 8)) return green;
    if (tiled && dot >= 112 && dot < (name === "obj-limit-34tiles" || y >= 24 ? 128 : 120) && y >= 16 && y < 32) return green;
    if (["obj-limit-32", "obj-limit-35tiles"].includes(name) && dot >= 80 && dot < 88 && y >= 16 && y < 24) return green;
  }
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
  if (name === "sprite-edges") {
    const xs = [0, 248, 252, -4, -8, -12];
    if (xs.some((left, i) => dot >= left && dot < left + 16 && y >= 16 + i * 24 && y < 32 + i * 24)) return green;
  }
  // SETINI=$03 halves the range height, but source Y still spans 16 rows.
  // Upper tiles are green/white on even/odd source rows, lower tiles transparent.
  // The fixed capture interleaves FIELD 0/1 in even/odd rows.
  if (name === "sprite-interlace" && dot >= 16 && dot < 32 && y >= 32 && y < 40) {
    return y & 1 ? [255, 255, 255, 255] : green;
  }
  // Vertical flip moves the upper tile to the bottom half and reverses the
  // alternating rows, including FIELD. The combined frame checks both fields.
  if (name === "sprite-interlace-vflip" && dot >= 16 && dot < 32 && y >= 40 && y < 48) {
    return y & 1 ? green : [255, 255, 255, 255];
  }
  // OBSEL=$c1: a 16x32 object flips within each 16-row square, so the
  // colored upper eight source rows stay in the first square after flipping.
  const rectTop = name === "sprite-rect-vflip" ? 24 : 16;
  if (["sprite-rect", "sprite-rect-vflip"].includes(name) && dot >= 16 && dot < 32 && y >= rectTop && y < rectTop + 8) {
    return (y & 1) ^ Number(name.endsWith("-vflip")) ? [255, 255, 255, 255] : green;
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
  if (["audio-mute", "audio-keyoff", "apu-endx"].includes(name)) return [0];
  if (name === "audio-echo-wrap") {
    // snes_spc echo_25: ARAM -32768 is halved before FIR, tap 7 is -128.
    // Cast the shifted product (+32768) to int16 BEFORE saturating the sum.
    const tap7 = ((((-32768 >> 1) * -128) >> 6) << 16) >> 16;
    const fir = Math.max(-32768, Math.min(32767, tap7)) & ~1;
    return [(fir * 127) >> 7]; // -32512 in both channels and the mono downmix
  }
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
  if (name === "audio-feedback") {
    // 512-sample echo buffer, tap 0 delayed by seven more samples. Each
    // write adds signed EFB=$40 times FIR. Iterate to an exact integer period.
    const voice = wave.map((s) => (((s * env) >> 11) & ~1) * 127 >> 7);
    const memory = Array(512).fill(0), history = Array(8).fill(0), output = [];
    for (let n = 0; n < 32768; n++) {
      history.shift(); history.push(memory[n % 512] >> 1);
      const fir = (history[0] & ~1); // $40/64, cleared low bit
      const v = voice[n % voice.length];
      memory[n % 512] = Math.max(-32768, Math.min(32767, v + ((fir * 64) >> 7))) & ~1;
      output.push(Math.max(-32768, Math.min(32767, ((v * 127) >> 7) + ((fir * 64) >> 7))));
    }
    return output.slice(-16);
  }
  if (name === "audio-echo") {
    // EDL=1: 512 stereo samples; FIR tap 0 reads seven samples back.
    // No feedback. FIR=$40, EVOL=$40, EON=1, echo writes clear bit 0.
    const voice = wave.map((s) => (((s * env) >> 11) & ~1) * 127 >> 7);
    return voice.map((v, i) => ((v * 127) >> 7) +
      ((((voice[(i + 16 - 7) % 16] & ~1) >> 1) & ~1) >> 1));
  }
  return wave.map(volume);
}

// This envelope oracle follows the independent DSP equations. KON does not
// reset the global rate counter, so test its two possible rate-30 phases.
function envelopePcm(name, phase) {
  const interpolated = [370, 1305, 374, 0].reduce((sum, coefficient) =>
    sum + ((14336 * coefficient) >> 11), 0) & ~1;
  const sample = (env) => ((((((interpolated * env) >> 11) & ~1) * 127) >> 7) * 127) >> 7;
  let env = 0, stage = "attack";
  const curve = [];
  for (let n = 0; n < 1600; n++) {
    curve.push(sample(env));
    let candidate = env, rate;
    if (stage === "attack") { candidate += 1024; rate = 1; }
    else {
      candidate--; candidate -= candidate >> 8;
      rate = stage === "decay" ? 2 : name === "audio-sustain" ? 1 : Infinity;
      if (stage === "decay" && candidate >> 8 === 4) stage = "sustain";
    }
    if (candidate > 2047) { candidate = 2047; stage = "decay"; }
    if (rate !== Infinity && (n + phase) % rate === 0) env = candidate;
  }
  const onset = curve.slice(1);
  const release = [];
  for (let level = env; level > 0; level = Math.max(0, level - 8)) release.push(sample(level));
  release.push(0, 0, 0, 0);
  return { onset, release, settled: sample(env) };
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

for (const [batchIndex, modeCartridges] of fixtureBatches.entries()) {
test(`full SNES RTL batch ${batchIndex + 1}/${fixtureBatches.length}: boots a local cartridge, renders DMA tiles, produces DSP PCM, handles input and repeats reset`, async ({ page }, info) => {
  // A 20-ROM batch leaves ample headroom within the existing 30-minute CI
  // deadline, even on runners where the former 120-ROM sweep timed out.
  test.setTimeout(1_800_000);
  const requests = [];
  page.on("console", (message) => {
    if (message.text().startsWith("SNES fixture ")) console.log(info.project.name, message.text());
  });
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
        if (modeResults.length % 10 === 0 || fixture.name.startsWith("apu-")) {
          console.log("SNES fixture", `${modeResults.length + 1}/${modeCartridges.length}`, fixture.name);
        }
        await load(new Uint8Array(fixture.bytes));
        let frame, height;
        const trace = [], pcm = [], hdma = [], observations = [];
        // Allow feedback to settle and the large Mode 7 map to initialize.
        // Interlace needs both fields; zero timers need 256 ticks plus a frame.
        const batches = fixture.name === "audio-feedback" ? 664 :
          fixture.name.startsWith("m7-over") ? 264 :
          fixture.name.includes("interlace") || fixture.name.startsWith("apu-timer-zero-") ? 224 : 164;
        for (let i = 0; i < batches; i++) {
          const output = await call({ action: "batch", batchCycles: i < 64 ? 512 : 16384,
            buttons: fixture.name === "auto" ? 2048 : fixture.name === "serial" ? 0xa55 : 0 });
          if (output.frame) { frame = output.frame; height = output.height; }
          if (output.audio) pcm.push(...output.audio);
          if (i < 64) trace.push(...output.trace);
          for (let j = 0; j < output.trace.length; j += 4) {
            const [cycle, address, value, flags] = output.trace.slice(j, j + 4);
            if (address === 0x7e3300 && (flags & 1)) observations.push([cycle, address, value, flags]);
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
        modeResults.push({ name: fixture.name, height, mismatches, examples, frameHash: frame && frameHash(frame),
          trace, pcm: pcm.slice(-256), onset: pcm.slice(onset, onset + 2048), hdma, observations });
      }
      return { first, repeat, hi, modeResults, metrics: window.compiled.metrics,
        validWasm: WebAssembly.validate(window.compiled.wasm) };
    } finally { worker.terminate(); }
  }, { cartridge: Array.from(rom), modeCartridges, pixelSource: pixel.toString() });
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
  const aux = results.modeResults.find((r) => r.name === "apu-aux");
  const auxRepeat = results.modeResults.find((r) => r.name === "apu-aux-repeat");
  if (aux && auxRepeat) {
    expect(auxRepeat.frameHash, "AUX checks repeat after power reset").toBe(aux.frameHash);
    expect(auxRepeat.pcm).toEqual(aux.pcm);
  }
  const fixtureEvidence = [];
  for (const { name, height, mismatches, examples, trace, pcm, onset, hdma, observations } of results.modeResults) {
    fixtureEvidence.push({ name, height, mismatches, examples, pcm: pcm.slice(0, 32), hdma });
    if (name.startsWith("reject-")) expect(mismatches, name).toBeGreaterThan(50000);
    else expect.soft({ mismatches, examples }, name).toEqual({ mismatches: 0, examples: [] });
    expect(pcm.length, `${name} retains the PCM sample clock`).toBe(256);
    if (["audio-decay-sustain", "audio-sustain", "audio-adsr-release"].includes(name)) {
      const phases = [0, 1].map((phase) => envelopePcm(name, phase));
      // Skip only interpolation startup. Compare every subsequent sample
      // through exponential decay and into the distinct sustain rate.
      const curveEnd = name === "audio-adsr-release" ? 224 : 512;
      expect(onset.length, `${name} captures the envelope transition`).toBeGreaterThanOrEqual(curveEnd);
      expect.soft(phases.some((e) => onset.slice(8, curveEnd).every((v, i) => v === e.onset[i + 8])),
        `${name} exact ADSR decay/sustain curve`).toBe(true);
      if (name === "audio-adsr-release") {
        expect.soft(phases.some((e) => onset.some((_, offset) => offset >= 224 &&
          e.release.every((v, i) => onset[offset + i] === v))), "ADSR KOFF subtracts eight per sample through zero").toBe(true);
        expect(pcm.every((v) => v === 0)).toBe(true);
      } else expect.soft(phases.some((e) => pcm.every((v) => v === e.settled)), `${name} settled envelope`).toBe(true);
    } else expect.soft(pcmMatches(pcm, expectedPcm(name)), `${name} independently calculated PCM`).toBe(true);
    if (name === "audio-ramp") {
      expect(Math.max(...onset.slice(0, 16).map(Math.abs))).toBeLessThan(6000);
      expect(Math.max(...onset.slice(64, 96).map(Math.abs))).toBeGreaterThan(13000);
    }
    if (name === "audio-adsr") expect(Math.max(...onset.slice(0, 16).map(Math.abs))).toBeGreaterThan(13000);
    if (name === "audio-keyoff") expect(onset.filter((sample) => sample !== 0).length).toBeGreaterThan(10);
    if (name === "apu-endx") expect(onset.some((sample) => sample !== 0)).toBe(true);
    if (name === "audio-echo") {
      expect(onset.length).toBeGreaterThanOrEqual(768);
      expect(pcmMatches(onset.slice(64, 500), expectedPcm("mode-0")), "echo's 512-sample delay").toBe(true);
      expect(pcmMatches(onset.slice(600, 768), expectedPcm("audio-echo"))).toBe(true);
    }
    expect(height, name).toBe(name.includes("interlace") ? 448 : name === "overscan" ? 239 : 224);
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
    if (["cgram-latch", "wbglog-open-bus"].includes(name)) {
      const expected = [0, 0, 0x80, 0x92, 0x5a, 0x23, 0, 0x80, 0x80, 0, 0x80, 0, 0, 0x92];
      expect(writes.filter((t) => t[1] >= 0x7e3200 && t[1] < 0x7e3200 + expected.length)
        .map((t) => [t[1], t[2]]), `${name} CPU CGRAM readback and PPU1/PPU2 latch isolation`).toEqual(
          expected.map((value, i) => [0x7e3200 + i, value]));
    }
    if (name === "slhv-latch") {
      const snapshots = writes.filter((t) => t[1] >= 0x7e3400 && t[1] < 0x7e3418);
      expect(snapshots.map((t) => t[1]), "six complete CPU counter snapshots").toEqual(
        Array.from({ length: 24 }, (_, i) => 0x7e3400 + i));
      const counters = Array.from({ length: 6 }, (_, i) => {
        const bytes = snapshots.slice(i * 4, i * 4 + 4).map((t) => t[2]);
        expect([bytes[1], bytes[3]].every((value) => value <= 1)).toBe(true);
        return { h: bytes[0] | bytes[1] << 8, v: bytes[2] | bytes[3] << 8 };
      });
      for (const { h, v } of counters) {
        expect(h).toBeLessThan(341);
        expect(v).toBeLessThan(262);
      }
      expect(counters[1].v, "enabled SLHV advances the captured counters").toBeGreaterThan(counters[0].v);
      expect(counters[2].v, "WRIO.7 falling edge still captures").toBeGreaterThan(counters[1].v);
      expect(counters[3], "disabled SLHV retains the falling-edge capture").toEqual(counters[2]);
      expect(counters[4], "WRIO.7 rising edge does not capture").toEqual(counters[2]);
      expect(counters[5].v, "re-enabled SLHV captures again").toBeGreaterThan(counters[2].v);
      fixtureEvidence.at(-1).counters = counters;
    }
    if (name.startsWith("obj-limit-")) {
      const flag = {"obj-limit-32": 0, "obj-limit-33": 0x40, "obj-limit-34tiles": 0, "obj-limit-35tiles": 0x80}[name];
      expect(observations.length, `${name} VBlank STAT77 observations`).toBeGreaterThanOrEqual(2);
      expect(observations.map(([, , value]) => value)).toEqual(Array(observations.length).fill(flag));
    }
    if (name === "multi") {
      expect(writes.filter((t) => t[1] === 0x2121 && t[2] >= 0x21 && t[2] <= 0x28)
        .map((t) => t[2]), "DMA channels 2 then 5 complete in priority order").toEqual([0x21,0x22,0x23,0x24,0x25,0x26,0x27,0x28]);
      const transfers = hdma.filter(([, value]) => [0x31, 0x51, 0x32, 0x52].includes(value));
      expect(transfers.length).toBeGreaterThanOrEqual(8);
      expect(transfers.map(([, value]) => value)).toEqual(transfers.map((_, i) => [0x31,0x51,0x32,0x52][i % 4]));
      expect(transfers.every(([cycle], i) => i % 2 === 0 || cycle - transfers[i - 1][0] <= 40)).toBe(true);
      const arbitration = hdma.filter(([, value]) => [0x29, 0x2a, 0x31, 0x51].includes(value));
      const interrupt = arbitration.findIndex(([, value], i) => value === 0x31 && i > 0 && arbitration[i - 1][1] === 0x29);
      expect(interrupt, "HBlank HDMA interrupts active DMA").toBeGreaterThan(0);
      expect(arbitration.slice(interrupt, interrupt + 3).map(([, value]) => value)).toEqual([0x31, 0x51, 0x29]);
      expect(arbitration.some(([, value]) => value === 0x2a), "second DMA channel completes after resume").toBe(true);
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
}

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
