const { test, expect } = require("@playwright/test");
const { readFileSync } = require("node:fs");

async function observeOutputs(page) {
  await page.addInitScript(() => {
    window.deliveries = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.wasm) window.lastWasm = data.wasm.slice();
          if (data.cycles !== undefined) {
            // Pause while a real batch is returning, before the UI consumes it.
            if (window.pauseOnNextDelivery) {
              window.pauseOnNextDelivery = false;
              document.getElementById("pause").click();
            }
            window.deliveries.push({ cycles: data.cycles, seconds: data.seconds,
              frameBytes: data.frame?.byteLength || 0, samples: data.audio?.length || 0 });
            if (window.deliveries.length > 100) window.deliveries.shift();
          }
        });
      }
    };
    // Observe the real Web Audio graph and PCM passed to it, without replacing
    // audio generation/playback. The analyser also sees the actual rendered signal.
    window.played = [];
    window.stopped = 0;
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(...args) {
        super(...args);
        window.audioContext = this;
        window.analyser = this.createAnalyser();
      }
      createBufferSource() {
        const source = super.createBufferSource();
        source.connect(window.analyser);
        const start = source.start.bind(source);
        source.start = (when) => {
          window.played.push({ rate: source.buffer.sampleRate,
            channels: source.buffer.numberOfChannels,
            pcm: Array.from(source.buffer.getChannelData(0).slice(0, 40)),
            ahead: when + source.buffer.duration - this.currentTime });
          if (window.played.length > 100) window.played.shift();
          start(when);
        };
        const stop = source.stop.bind(source);
        source.stop = () => { window.stopped++; stop(); };
        return source;
      }
    };
  });
}

async function compile(page) {
  await page.locator("#compile").click();
  await expect(page.locator("#step")).toBeEnabled({ timeout: 120000 });
  await expect(page.locator("#errors")).toBeHidden();
}

async function select(page, board) {
  await page.locator("#example").selectOption(board === "counter" ? "single" : board);
  await page.locator("#load-example").click();
  await expect(page.locator("#source")).toHaveValue(readFileSync(`examples/${board}.v`, "utf8"));
  await expect(page.getByLabel("Output interface", { exact: true })).toHaveValue(board);
}

async function pixels(page) {
  return page.locator("#video").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    return [0, 16, 32, 48].map((x) => Array.from(context.getImageData(x, 0, 1, 1).data));
  });
}

// Probe the newly compiled module through the same worker protocol to verify
// precise simulated cycles, framing, sample cadence and bounded batch behavior.
async function probe(page, board, commands) {
  return page.evaluate(async ({ board, commands }) => {
    const worker = new Worker("./simulator-worker.js", { type: "module" });
    const call = (message) => new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => resolve(data);
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage({ id: 1, ...message });
    });
    try {
      const init = await call({ action: "init", board, wasm: window.lastWasm });
      if (init.error) throw new Error(init.error);
      const results = [];
      for (const message of commands) {
        const data = await call(message);
        results.push({ ...data, frame: data.frame ? Array.from(data.frame.slice(0, 4)) : null,
          frameBytes: data.frame?.length || 0, audio: data.audio ? Array.from(data.audio) : [] });
      }
      return results;
    } finally { worker.terminate(); }
  }, { board, commands });
}

test("video supports multiple source files, a selected top, and independent interface changes", async ({ page }) => {
  await page.goto("./");
  await select(page, "video");
  const source = page.locator("#source");
  const edited = readFileSync("examples/video.v", "utf8")
    .replace("module video(", "module display_top(")
    .replace("    reg [5:0] x, y;", "    wire [23:0] left_color;\n    pattern colors(left_color);\n    reg [5:0] x, y;")
    .replace("24'hff0000", "left_color");
  await source.fill(edited);
  await page.getByLabel("Top module", { exact: true }).fill("display_top");
  const helper = "module pattern(output [23:0] color); assign color = 24'h804020; endmodule";
  await page.locator("#import-files").setInputFiles({
    name: "pattern.v", mimeType: "text/plain", buffer: Buffer.from(helper),
  });
  await expect(source).toHaveValue(helper);
  await compile(page);
  await page.locator("#run").click();
  const expected = [[128, 64, 32, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]];
  await expect.poll(() => pixels(page)).toEqual(expected);
  await page.locator("#pause").click();
  await page.getByLabel("Source file", { exact: true }).selectOption("video.v");
  await expect(source).toHaveValue(edited);
  await expect(page.locator("#run")).toBeEnabled();
  await page.getByLabel("Output interface", { exact: true }).selectOption("counter");
  await expect(page.locator("#run")).toBeDisabled();
  await expect(page.locator("#video")).toBeHidden();
  await expect(source).toHaveValue(edited);
  await expect(page.locator("#top")).toHaveValue("display_top");
  await expect(page.locator("#files option")).toHaveText(["video.v", "pattern.v"]);
});

test("video frames come from edited RTL, with precise framing and clean controls", async ({ page }) => {
  await observeOutputs(page);
  await page.goto("./");
  await select(page, "video");
  await compile(page);
  const [partial, frame, reset, oversized] = await probe(page, "video", [
    { action: "batch", batchCycles: 3071 }, { action: "step" },
    { action: "reset" }, { action: "batch", batchCycles: 16385 },
  ]);
  expect(partial.frame).toBeNull();
  expect(partial.cycles).toBe(3071);
  expect(frame.frame).toEqual([255, 0, 0, 255]);
  expect(frame.frameBytes).toBe(64 * 48 * 4);
  expect(frame.seconds).toBeCloseTo(1 / 60, 10);
  expect(reset.cycles).toBe(0);
  expect(reset.frame).toBeNull();
  expect(oversized.error).toContain("Invalid simulation batch size");
  await page.locator("#run").click();
  const bars = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]];
  await expect.poll(() => pixels(page)).toEqual(bars);
  await page.locator("#pause").click();
  const time = await page.locator("#timing").textContent();
  await page.waitForTimeout(150);
  await expect(page.locator("#timing")).toHaveText(time);
  expect(await pixels(page)).toEqual(bars);
  await page.locator("#reset").click();
  await expect(page.locator("#timing")).toHaveText("0 cycles · 0.000 simulated seconds");
  expect(await pixels(page)).toEqual(Array(4).fill([0, 0, 0, 0]));
  await expect(page.locator("#run")).toBeEnabled(); // Reset reply must settle before arming the Run race.
  await page.evaluate(() => { window.pauseOnNextDelivery = true; });
  await page.locator("#run").click();
  await expect(page.locator("#pause")).toBeDisabled();
  await expect(page.locator("#run")).toBeEnabled();
  await expect(page.locator("#timing")).toHaveText("0 cycles · 0.000 simulated seconds");
  expect(await pixels(page)).toEqual(Array(4).fill([0, 0, 0, 0]));
  await page.locator("#reset").click();
  await page.locator("#step").click();
  await expect(page.locator("#timing")).toContainText("1 cycles");
  expect(await pixels(page)).toEqual(Array(4).fill([0, 0, 0, 0]));

  const edited = readFileSync("examples/video.v", "utf8").replace("24'hff0000", "24'h804020");
  await page.locator("#source").fill(edited);
  await compile(page);
  await page.locator("#run").click();
  await expect.poll(() => pixels(page)).toEqual([[128, 64, 32, 255], ...bars.slice(1)]);
  await page.locator("#pause").click();
  const deliveries = await page.evaluate(() => window.deliveries);
  expect(deliveries.filter((d) => d.frameBytes).every((d) => d.frameBytes === 12288 && !d.samples)).toBe(true);
  // Invalid coordinates fault in the isolated runtime and permit recompilation.
  await page.locator("#source").fill(edited.replace("video_y <= y", "video_y <= 48"));
  await compile(page);
  await page.locator("#run").click();
  await expect(page.locator("#errors")).toContainText("Circuit execution failed");
  await expect(page.locator("#run")).toBeDisabled();
  await select(page, "counter");
  await expect(page.locator("#video")).toBeHidden();
  await expect(page.locator("#run")).toBeDisabled();
});

test("PCM originates in RTL, plays through Web Audio, and clears on Pause/Reset/edit", async ({ page }) => {
  await observeOutputs(page);
  await page.goto("./");
  await select(page, "audio");
  await compile(page);
  const [idle, first, period, reset, afterReset, maximum] = await probe(page, "audio", [
    { action: "batch", batchCycles: 5 }, { action: "step" },
    { action: "batch", batchCycles: 114 }, { action: "reset" }, { action: "batch", batchCycles: 6 },
    { action: "batch", batchCycles: 16384 },
  ]);
  expect(idle.audio).toEqual([]);
  expect(first.audio).toEqual([8192]);
  expect(first.seconds).toBeCloseTo(1 / 8000, 10);
  expect([8192, ...period.audio]).toEqual([...Array(10).fill(8192), ...Array(10).fill(-8192)]);
  expect(reset.audio).toEqual([]);
  expect(reset.cycles).toBe(0);
  expect(afterReset.audio).toEqual([8192]);
  expect(maximum.audio.length).toBe(2730);
  await page.locator("#step").click();
  await expect(page.locator("#timing")).toContainText("1 cycles");
  expect(await page.evaluate(() => window.played.length)).toBe(0);

  // Exercise a browser permission/API rejection, then restore real audio and retry.
  await page.evaluate(() => {
    window.resumeAudio = AudioContext.prototype.resume;
    AudioContext.prototype.resume = () => Promise.reject(new Error("Audio permission denied"));
  });
  await page.locator("#run").click();
  await expect(page.locator("#audio-status")).toContainText("Audio permission denied");
  await expect(page.locator("#run")).toBeEnabled();
  await page.evaluate(() => { AudioContext.prototype.resume = window.resumeAudio; });
  await page.locator("#reset").click();
  await page.locator("#run").click();
  await expect.poll(() => page.evaluate(() => window.played.length)).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => {
    const data = new Float32Array(window.analyser.fftSize);
    window.analyser.getFloatTimeDomainData(data);
    return Math.max(...data.map(Math.abs));
  })).toBeGreaterThan(0.1);
  const played = await page.evaluate(() => window.played[0]);
  expect(played.rate).toBe(8000);
  expect(played.channels).toBe(1);
  expect(played.pcm.slice(0, 20)).toEqual([...Array(10).fill(0.25), ...Array(10).fill(-0.25)]);
  expect(played.ahead).toBeLessThanOrEqual(0.25);
  await page.evaluate(() => window.audioContext.suspend());
  await expect(page.locator("#audio-status")).toContainText("Audio was suspended");
  await expect(page.locator("#run")).toBeEnabled();
  const suspendedCount = await page.evaluate(() => window.played.length);
  await page.locator("#run").click();
  await expect.poll(() => page.evaluate(() => window.played.length)).toBeGreaterThan(suspendedCount);
  await page.locator("#pause").click();
  await expect.poll(() => page.evaluate(() => window.stopped)).toBeGreaterThan(0);
  const paused = await page.evaluate(() => window.played.length);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.played.length)).toBe(paused);
  await page.locator("#reset").click();
  await expect(page.locator("#timing")).toHaveText("0 cycles · 0.000 simulated seconds");

  // Change both amplitude and period in HDL; browser playback must follow both.
  const edited = readFileSync("examples/audio.v", "utf8")
    .replaceAll("16'sd8192", "16'sd4096").replace("phase < 10", "phase < 5").replace("phase == 19", "phase == 9");
  await page.locator("#run").click();
  await page.locator("#source").fill(edited);
  await expect(page.locator("#pause")).toBeDisabled();
  await expect(page.locator("#run")).toBeDisabled();
  await compile(page);
  await page.evaluate(() => { window.played = []; });
  await page.locator("#run").click();
  await expect.poll(() => page.evaluate(() => window.played.length)).toBeGreaterThan(0);
  const changed = await page.evaluate(() => window.played[0]);
  expect(changed.pcm.slice(0, 20)).toEqual(Array(2).fill([...Array(5).fill(0.125), ...Array(5).fill(-0.125)]).flat());
  // Reset during Run must silence scheduled data and rewind simulation time.
  // Deliver Reset atomically with its enabled check, between worker batches.
  await page.waitForFunction(() => {
    const reset = document.getElementById("reset");
    const cycles = Number.parseInt(document.getElementById("timing").textContent, 10);
    if (!(cycles > 0)
        || document.getElementById("pause").disabled || reset.disabled) return false;
    reset.click();
    return true;
  });
  // Wait for the worker to acknowledge Reset before checking the cleared output.
  await expect(page.locator("#step")).toBeEnabled();
  await expect(page.locator("#pause")).toBeDisabled();
  await expect(page.locator("#timing")).toHaveText("0 cycles · 0.000 simulated seconds");
  const stopped = await page.evaluate(() => window.played.length);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.played.length)).toBe(stopped);
  expect(await page.evaluate(() => window.played.every((p) => p.ahead <= 0.25))).toBe(true);
  const deliveries = await page.evaluate(() => window.deliveries);
  expect(deliveries.filter((d) => d.samples).every((d) => d.samples <= 2731 && !d.frameBytes)).toBe(true);
});
