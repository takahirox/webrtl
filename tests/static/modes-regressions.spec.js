const { test, expect } = require("@playwright/test");

async function compile(page, source) {
  await page.goto("./");
  await page.evaluate(async (source) => {
    const compiler = new Worker("./compiler-worker.js", { type: "module" });
    let wasm;
    try {
      wasm = await new Promise((resolve, reject) => {
        compiler.onmessage = ({ data }) => {
          if (data.error) reject(new Error(data.error));
          if (data.wasm) resolve(data.wasm);
        };
        compiler.onerror = (event) => reject(new Error(event.message));
        compiler.postMessage({ top: "regression", board: "generic", files: { "regression.v": source } });
      });
    } finally { compiler.terminate(); }
    const worker = window.simWorker = new Worker("./simulator-worker.js", { type: "module" });
    window.simCall = (message) => new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage({ id: 1, board: "generic", ...message });
    });
    await window.simCall({ action: "init", wasm });
  }, source);
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.simWorker?.terminate());
});

test("clock-triggered asynchronous cascades settle across Fast/Debug capture and conditions", async ({ page }) => {
  // Exercise both clock levels in one compiled model, including cascades that
  // require more than two evaluations after a counter wraps.
  await compile(page, `module regression(input clk, input reset,
      output [7:0] rising_q, rising_y, rising_r, rising_z, rising_s, rising_w,
      output [7:0] falling_q, falling_y, falling_r, falling_z, falling_s, falling_w);
    cascade rising(clk, reset, rising_q, rising_y, rising_r, rising_z, rising_s, rising_w);
    cascade falling(~clk, reset, falling_q, falling_y, falling_r, falling_z, falling_s, falling_w);
  endmodule
  module cascade(input clk, input reset, output reg [7:0] q, output [7:0] y,
      output reg [7:0] r, output [7:0] z, output reg [7:0] s, output [7:0] w);
    always @(posedge clk) if (reset) q <= 0; else q <= q + 1;
    wire q_zero = q == 0, r_zero = r == 0;
    always @(posedge clk or posedge q_zero)
      if (q_zero) r <= 0; else if (reset) r <= 0; else r <= r + 1;
    always @(posedge clk or posedge r_zero)
      if (r_zero) s <= 0; else if (reset) s <= 0; else s <= s + 1;
    assign y = q + 1;
    assign z = r + 1;
    assign w = s + 1;
  endmodule`);
  const results = await page.evaluate(async () => {
    const call = window.simCall;
    const { signals } = await call({ action: "mode", mode: "debug" });
    const names = ["rising", "falling"].flatMap((edge) => ["q", "y", "r", "z", "s", "w"].map((name) => `${edge}_${name}`));
    const refs = names.map((name) => ({ id: signals.find((s) => s.name === name).id, row: 0 }));
    const read = async () => (await call({ action: "inspect", refs })).values.map((v) => parseInt(v.hex, 16));
    await call({ action: "mode", mode: "fast" });
    await call({ action: "batch", batchCycles: 512 });
    await call({ action: "mode", mode: "debug" });
    const uninterrupted = await read();
    const results = [];
    for (const edge of ["rising", "falling"]) {
      await call({ action: "reset" });
      await call({ action: "mode", mode: "fast" });
      await call({ action: "batch", batchCycles: 256 });
      const { snapshot: fastSnapshot } = await call({ action: "pause" });
      await call({ action: "mode", mode: "debug", snapshot: fastSnapshot });
      const fastBoundary = await read();

      await call({ action: "reset" });
      await call({ action: "mode", mode: "fast" });
      await call({ action: "batch", batchCycles: 255 });
      await call({ action: "mode", mode: "debug" });
      const beforeWrap = await read();
      await call({ action: "debug-config", signals: refs,
        breakpoint: { ...refs[names.indexOf(`${edge}_z`)], kind: "value", value: 1 } });
      const stop = await call({ action: "batch", batchCycles: 4 });
      const stopped = await read();
      const neutral = await call({ action: "inputs", inputs: {} });
      const afterNeutral = await read();
      const step = await call({ action: "step" });
      const { snapshot: debugSnapshot } = await call({ action: "pause" });
      await call({ action: "mode", mode: "fast", snapshot: debugSnapshot });
      await call({ action: "batch", batchCycles: 255 });
      await call({ action: "mode", mode: "debug" });
      results.push({ uninterrupted, fastSnapshot, fastBoundary, beforeWrap, stop, stopped,
        neutral, afterNeutral, step, debugSnapshot, resumed: await read() });
    }
    return results;
  });
  const wrapped = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1];
  const next = [1, 2, 0, 1, 0, 1, 1, 2, 0, 1, 0, 1];
  for (const result of results) {
    expect(result.fastSnapshot).toMatchObject({ cycles: 256, phase: "settled-low" });
    expect(result.fastBoundary).toEqual(wrapped);
    expect(result.beforeWrap).toEqual([255, 0, 254, 255, 253, 254, 255, 0, 254, 255, 253, 254]);
    expect(result.stop).toMatchObject({ cycles: 256, hit: true,
      snapshot: { cycles: 256, phase: "settled-low" }, history: [{ cycle: 256, values: wrapped }] });
    expect(result.stopped).toEqual(wrapped);
    expect(result.neutral.cycles).toBe(256);
    expect(result.afterNeutral).toEqual(result.stopped);
    expect(result.step.history).toEqual([{ cycle: 256, values: wrapped }, { cycle: 257, values: next }]);
    expect(result.debugSnapshot).toMatchObject({ cycles: 257, phase: "settled-low" });
    expect(result.resumed).toEqual(wrapped);
    expect(result.resumed).toEqual(result.uninterrupted);
  }
});

test("inspection formats high-bit-set 32-bit and multiword inputs, registers and RAM as unsigned hex", async ({ page }) => {
  await compile(page, `module regression(input clk, input reset, input address, input [64:0] data,
      output reg [31:0] stored32, output reg [64:0] stored65, output [64:0] loaded);
    reg [64:0] memory [0:1];
    assign loaded = memory[address];
    always @(posedge clk) begin
      if (reset) begin
        stored32 <= 32'hffffffff;
        stored65 <= 65'h1ffffffff80000000;
        memory[0] <= 65'h180000000ffffffff;
        memory[1] <= 65'h1ffffffff80000000;
      end else begin
        stored32 <= data[31:0];
        stored65 <= data;
        memory[address] <= data;
      end
    end
  endmodule`);
  const result = await page.evaluate(async () => {
    const call = window.simCall;
    const { signals } = await call({ action: "mode", mode: "debug" });
    const ref = (name, row = 0) => ({ id: signals.find((s) => s.name === name).id, row });
    const refs = [ref("stored32"), ref("stored65"), ref("loaded"), ref("memory"), ref("memory", 1)];
    const read = async (refs) => (await call({ action: "inspect", refs })).values.map((v) => v.hex);
    const initial = await read(refs);
    await call({ action: "inputs", inputs: { data: "0x1ffffffff80000000" } });
    const input = await read([ref("data")]);
    await call({ action: "step" });
    return { initial, input, stepped: await read(refs) };
  });
  expect(result.initial).toEqual(["ffffffff", "1ffffffff80000000", "180000000ffffffff", "180000000ffffffff", "1ffffffff80000000"]);
  expect(result.input).toEqual(["1ffffffff80000000"]);
  expect(result.stepped).toEqual(["80000000", "1ffffffff80000000", "1ffffffff80000000", "1ffffffff80000000", "1ffffffff80000000"]);
});
