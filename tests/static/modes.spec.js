const { test, expect } = require("@playwright/test");

async function load(page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.wasm) window.lastWasm = data.wasm.slice();
          if (data.snapshot) window.lastSnapshot = data.snapshot;
          if (data.cycles !== undefined) window.lastDelivery = data;
        });
      }
      postMessage(message, ...args) {
        super.postMessage(message, ...args);
        if (window.pauseOnRequest && message.action === "batch") {
          window.pauseOnRequest = false;
          queueMicrotask(() => {
            window.pausedWhilePending = document.getElementById("step").disabled;
            document.getElementById("pause").click();
          });
        }
      }
    };
  });
  await page.goto("./");
  await page.locator("#example").selectOption("debug-ram");
  await page.locator("#load-example").click();
  await expect(page.locator("#top")).toHaveValue("debug_ram");
  await page.locator("#compile").click();
  await expect(page.locator("#compile")).toBeEnabled({ timeout: 120000 });
  await expect(page.locator("#errors")).toBeHidden();
  await expect(page.locator("#step")).toBeEnabled();
}

test("generic RTL retains RAM, both clock edges and inputs through Fast/Debug handoff", async ({ page }) => {
  await load(page);
  const result = await page.evaluate(async () => {
    const worker = new Worker("./simulator-worker.js", { type: "module" });
    const call = (message) => new Promise((resolve) => {
      worker.onmessage = ({ data }) => resolve(data);
      worker.postMessage({ id: 1, board: "generic", ...message });
    });
    const check = async (message) => {
      const data = await call(message);
      if (data.error) throw new Error(data.error);
      return data;
    };
    try {
      await check({ action: "init", wasm: window.lastWasm });
      const { signals } = await check({ action: "mode", mode: "debug" });
      const ref = (name, row = 0) => ({ id: signals.find((s) => s.name === name).id, row });
      const memory = signals.find((s) => s.name.endsWith("memory"));
      if (!memory || memory.depth !== 16) throw new Error("Writable hierarchical RAM not discoverable");
      const refs = signals.flatMap((s) => Array.from({ length: s.depth }, (_, row) => ({ id: s.id, row })));
      const read = async () => (await check({ action: "inspect", refs })).values;
      const inputs = (stimulus, enable = "0x1") => check({ action: "inputs", inputs: { stimulus, enable } });
      const batch = (batchCycles) => check({ action: "batch", batchCycles });
      await check({ action: "mode", mode: "fast" });
      await inputs("0x13"); await batch(7);
      await inputs("0x29"); await batch(11);
      await inputs("0x7", "0x0"); await batch(3);
      await inputs("0x7"); await batch(400);
      await check({ action: "mode", mode: "debug" });
      const uninterrupted = await read();
      const finalCycles = (await check({ action: "pause" })).cycles;
      await check({ action: "reset" });
      const cleared = await check({ action: "inspect", refs: Array.from({ length: 16 }, (_, row) => ({ id: memory.id, row })) });
      await check({ action: "mode", mode: "fast" });
      await inputs("0x13"); await batch(7);
      const { snapshot } = await check({ action: "pause" });
      const invalid = await call({ action: "mode", mode: "debug", snapshot: { ...snapshot, version: 999 } });
      const handoff = await check({ action: "mode", mode: "debug", snapshot });
      const firstState = await check({ action: "inspect", refs: [ref("sum"), ref("shadow"), { id: memory.id, row: 0 }] });
      await check({ action: "debug-config", signals: [ref("sum"), { id: memory.id, row: 0 }] });
      await inputs("0x29"); await check({ action: "step" }); await batch(10);
      await inputs("0x7", "0x0"); await batch(3);
      await inputs("0x7");
      const captured = await batch(300);
      const { snapshot: back } = await check({ action: "pause" });
      await check({ action: "mode", mode: "fast", snapshot: back });
      const fast = await batch(100);
      await check({ action: "mode", mode: "debug" });
      const resumed = await read();
      const stale = await call({ action: "mode", mode: "fast", snapshot });
      await check({ action: "reset" }); await inputs("0x3");
      await check({ action: "debug-config", signals: [ref("address")], breakpoint: { ...ref("address"), kind: "value", value: 9 } });
      const stop = await batch(100);
      await check({ action: "debug-config", signals: [], breakpoint: { ...ref("address"), kind: "change" } });
      const edge = await batch(100);
      await check({ action: "debug-config", signals: [], breakpoint: { ...ref("address"), kind: "falling" } });
      const falling = await batch(100);
      await check({ action: "debug-config", signals: [], breakpoint: { ...ref("address"), kind: "rising" } });
      const rising = await batch(100);
      const wide = await call({ action: "debug-config", signals: [ref("wide_state")] });
      const badInput = await call({ action: "inputs", inputs: { stimulus: "0x100" } });
      await check({ action: "init", wasm: window.lastWasm });
      const newInstance = await call({ action: "mode", mode: "debug", snapshot: back });
      return { signals, uninterrupted, resumed, finalCycles, cleared, snapshot, invalid, handoff,
        captured, fast, stale, stop, edge, falling, rising, firstState, wide, badInput, newInstance };
    } finally { worker.terminate(); }
  });
  expect(result.resumed).toEqual(result.uninterrupted);
  expect(result.finalCycles).toBe(421);
  expect(result.fast.cycles).toBe(421);
  expect(result.cleared.values.every((v) => v.hex === "00")).toBe(true);
  expect(result.snapshot).toMatchObject({ version: 1, phase: "settled-low", retention: "shared-live-model", inputs: { stimulus: "0x13", enable: "0x1" }, cycles: 7 });
  expect(result.handoff.cycles).toBe(7);
  expect(result.captured.history).toHaveLength(256);
  expect(result.captured.history[0].cycle).toBe(66);
  expect(result.captured.history.at(-1).cycle).toBe(321);
  expect(result.fast.history).toBeUndefined();
  expect(result.stop).toMatchObject({ cycles: 9, hit: true });
  expect(result.edge).toMatchObject({ cycles: 10, hit: true });
  expect(result.falling).toMatchObject({ cycles: 16, hit: true });
  expect(result.rising).toMatchObject({ cycles: 17, hit: true });
  expect(result.firstState.values.map((v) => v.hex)).toEqual(["0085", "12b1", "13"]);
  for (const key of ["invalid", "stale", "newInstance"]) expect(result[key].error).toContain("Incompatible or expired live snapshot");
  expect(result.wide.error).toContain("32 bits");
  expect(result.badInput.error).toContain("Invalid unsigned hex input");
  // Independent expected outputs catch an equal-but-wrong reset/clock implementation.
  const sumId = result.signals.find((s) => s.name === "sum").id;
  const shadowId = result.signals.find((s) => s.name === "shadow").id;
  const sum = parseInt(result.resumed.find((v) => v.id === sumId).hex, 16);
  expect(parseInt(result.resumed.find((v) => v.id === shadowId).hex, 16)).toBe(sum ^ 0x1234);
  expect(sum).toBeGreaterThan(400);
});

test("mode controls inspect/stop, pause a pending Fast batch, reset and recompile", async ({ page }) => {
  await load(page);
  await expect(page.locator("#sim-mode")).toHaveValue("fast");
  await expect(page.locator("#debug-controls")).toBeHidden();
  await page.locator("#sim-mode").selectOption("debug");
  await expect(page.locator("#signals option")).not.toHaveCount(0);
  await page.locator("#input-signal").selectOption("enable");
  await page.locator("#input-value").fill("0x1");
  await page.locator("#apply-input").click();
  const address = await page.locator("#signals option").evaluateAll((options) => options.find((o) => o.textContent.startsWith("address ")).value);
  await page.locator("#signals").selectOption(address);
  await page.locator("#condition").selectOption("value");
  await page.locator("#condition-value").fill("3");
  await page.locator("#capture").click();
  await page.locator("#run").click();
  await expect(page.locator("#status")).toContainText("Condition met at cycle 3");
  await expect(page.locator("#signal-values")).toContainText("= 0x3");
  await expect(page.locator("#signal-history")).toContainText("3: 0x3");
  await page.locator("#sim-mode").selectOption("fast");
  await expect(page.locator("#status")).toContainText("paused at cycle 3");
  await page.evaluate(() => { window.pauseOnRequest = true; });
  await page.locator("#run").click();
  await expect(page.locator("#run")).toBeEnabled();
  const paused = await page.evaluate(() => window.lastSnapshot.cycles);
  expect(paused).toBeGreaterThan(3);
  expect(await page.evaluate(() => window.pausedWhilePending)).toBe(true);
  await expect(page.locator("#timing")).toContainText(`${paused} cycles`);
  await expect(page.locator("#timing")).not.toContainText("real time");
  await page.locator("#sim-mode").selectOption("debug");
  await expect(page.locator("#status")).toContainText(`paused at cycle ${paused}`);
  await page.locator("#step").click();
  await expect(page.locator("#timing")).toContainText(`${paused + 1} cycles`);
  await page.locator("#reset").click();
  await expect(page.locator("#timing")).toHaveText("0 cycles · clock rate unspecified");
  await expect(page.locator("#signal-history")).toBeEmpty();
  await expect(page.locator("#condition")).toHaveValue("none");
  await page.locator("#source").fill((await page.locator("#source").inputValue()).replace("sum + read_data + stimulus", "sum + read_data + stimulus + 1"));
  await expect(page.locator("#run")).toBeDisabled();
  await page.locator("#compile").click();
  await expect(page.locator("#step")).toBeEnabled({ timeout: 120000 });
  await expect(page.locator("#sim-mode")).toHaveValue("fast");
  await page.locator("#step").click();
  await expect(page.locator("#timing")).toContainText("1 cycles");
  await page.locator("#sim-mode").selectOption("debug");
  await expect(page.locator("#sim-mode")).toBeEnabled();
  await page.locator("#input-signal").selectOption("enable");
  await page.locator("#apply-input").click();
  await page.locator("#step").click();
  await expect(page.locator("#step")).toBeEnabled();
  const sum = await page.locator("#signals option").evaluateAll((options) => options.find((o) => o.textContent.startsWith("sum ")).value);
  await page.locator("#signals").selectOption(sum);
  await page.locator("#inspect").click();
  await expect(page.locator("#signal-values")).toContainText("= 0x0001");
  await page.locator("#clock-hz").fill("1000");
  await page.locator("#step").click();
  await expect(page.locator("#timing")).toContainText("3 cycles · 0.003 simulated seconds");
  await expect(page.locator("#timing")).toContainText("× real time");
});
