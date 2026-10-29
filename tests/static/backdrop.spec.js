const { test, expect } = require("@playwright/test");
const { readFileSync } = require("node:fs");
const rtl = (name) => readFileSync(`examples/cpu816-backdrop/${name}`, "utf8");
const row = (trace) => Array.from({ length: trace.length / 4 }, (_, i) => trace.slice(i * 4, i * 4 + 4));

async function load(page) {
  await page.addInitScript(() => {
    window.circuits = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.wasm) {
            window.lastWasm = data.wasm.slice();
            window.circuits.push({ valid: WebAssembly.validate(data.wasm), bytes: data.wasm.length });
          }
          if (data.frame) {
            window.lastFrame = Array.from(data.frame);
            // Pause on delivery to exercise the UI's in-flight output handling.
            if (window.pauseOnFrame) {
              window.pauseOnFrame = false;
              document.getElementById("pause").click();
            }
          }
        });
      }
    };
  });
  await page.goto(process.env.WEBRTL_PUBLIC_URL || "./");
  await page.locator("#example").selectOption("backdrop");
  await page.locator("#load-example").click();
  await expect(page.locator("#source")).toHaveValue(rtl("cpu816-backdrop.v"));
  await expect(page.locator("#files option")).toHaveCount(13);
  await expect(page.locator("#interface")).toHaveValue("video");
  await expect(page.locator("#top")).toHaveValue("cpu816_backdrop");
}
async function edit(page, name, source) {
  await page.locator("#files").selectOption(name);
  await page.locator("#source").fill(source);
  await expect(page.locator("#step")).toBeDisabled();
}
async function compile(page) {
  const start = Date.now();
  await page.locator("#compile").click();
  await expect(page.locator("#compile")).toBeEnabled({ timeout: 120000 });
  await expect(page.locator("#errors")).toBeHidden();
  await expect(page.locator("#step")).toBeEnabled();
  return Date.now() - start;
}
async function pixels(page) {
  return page.locator("#video").evaluate((canvas) =>
    Array.from(canvas.getContext("2d").getImageData(0, 0, 64, 48).data));
}
function solid(frame, rgba) {
  expect(frame).toHaveLength(64 * 48 * 4);
  expect(frame.every((byte, i) => byte === rgba[i % 4])).toBe(true);
}
async function reset(page) {
  await page.locator("#reset").click();
  await expect(page.locator("#step")).toBeEnabled();
  await expect(page.locator("#pause")).toBeDisabled();
  solid(await pixels(page), [0, 0, 0, 0]);
  await expect(page.locator("#timing")).toContainText("0 cycles");
}
async function show(page, rgba) {
  await page.locator("#run").click();
  await expect.poll(async () => (await pixels(page)).slice(0, 4)).toEqual(rgba);
  await page.locator("#pause").click();
  await expect(page.locator("#step")).toBeEnabled();
  const frame = await pixels(page);
  solid(frame, rgba);
  expect(frame).toEqual(await page.evaluate(() => window.lastFrame));
}
async function probe(page, board, commands) {
  return page.evaluate(async ({ board, commands }) => {
    const worker = new Worker("./simulator-worker.js", { type: "module" });
    let id = 0;
    const call = (message) => new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage({ id: id++, board, ...message });
    });
    try {
      await call({ action: "init", wasm: window.lastWasm });
      const results = [];
      for (const command of commands) {
        const data = await call(command);
        results.push({ ...data, frame: data.frame ? Array.from(data.frame) : null,
          trace: data.trace ? Array.from(data.trace) : [] });
      }
      return results;
    } finally { worker.terminate(); }
  }, { board, commands });
}
function colorRom(low, high, display = "0f") {
  return rtl("backdrop-rom.v")
    .replace("16'h800c: data = 8'h1f", `16'h800c: data = 8'h${low}`)
    .replace("16'h8011: data = 8'h00", `16'h8011: data = 8'h${high}`)
    .replace("16'h8016: data = 8'h0f", `16'h8016: data = 8'h${display}`);
}

test("CPU backdrop compiles, renders, edits ROM color and resets through the Video pipeline", async ({ page }, testInfo) => {
  const requests = [], errors = [];
  page.on("request", (request) => requests.push(request));
  page.on("pageerror", (error) => errors.push(error.message));
  await load(page);
  const compileMs = await compile(page);
  const frames = await probe(page, "video", [
    { action: "batch", batchCycles: 3071 }, { action: "step" },
    { action: "batch", batchCycles: 3071 }, { action: "step" },
    // Reset within CPU initialization, a half-written pair, and a partial frame.
    ...[15, 27, 33, 39, 4000].flatMap((batchCycles) => [
      { action: "reset" }, { action: "batch", batchCycles },
      { action: "reset" }, { action: "batch", batchCycles: 6144 },
    ]),
  ]);
  expect(frames[0].frame).toBeNull();
  solid(frames[1].frame, [0, 0, 0, 255]); // first frame snapshots reset forced blank
  expect(frames[2].frame).toBeNull();
  solid(frames[3].frame, [255, 0, 0, 255]);
  for (let i = 4; i < frames.length; i += 4) {
    expect(frames[i].cycles).toBe(0);
    expect(frames[i].frame).toBeNull();
    expect(frames[i + 2].frame).toBeNull();
    solid(frames[i + 3].frame, [255, 0, 0, 255]);
  }
  await page.locator("#step").click();
  await expect(page.locator("#step")).toBeEnabled();
  solid(await pixels(page), [0, 0, 0, 0]); // no partial frame shown
  await show(page, [255, 0, 0, 255]);
  const paused = await pixels(page);
  await page.waitForTimeout(80);
  expect(await pixels(page)).toEqual(paused);
  await reset(page);
  await show(page, [255, 0, 0, 255]);
  // Reset while Run is active, between requests.
  await page.locator("#run").click();
  await page.waitForFunction(() => {
    const reset = document.getElementById("reset");
    if (reset.disabled || document.getElementById("pause").disabled) return false;
    reset.click(); return true;
  });
  await expect(page.locator("#step")).toBeEnabled();
  solid(await pixels(page), [0, 0, 0, 0]);
  await show(page, [255, 0, 0, 255]);

  const performance = await page.evaluate(async () => {
    const unavailable = () => { throw new Error("Unexpected WASI I/O"); };
    const { instance: { exports: sim } } = await WebAssembly.instantiate(window.lastWasm, {
      wasi_snapshot_preview1: { fd_close: unavailable, fd_seek: unavailable, fd_write: unavailable },
    });
    sim._initialize(); sim.sim_reset(); sim.sim_batch(6144);
    const start = window.performance.now();
    for (let i = 0; i < 100; i++) sim.sim_batch(3072);
    const ms = window.performance.now() - start;
    return { ms, cyclesPerSecond: 307200000 / ms, framesPerSecond: 100000 / ms, ...window.circuits[0] };
  });
  const measurement = { browser: testInfo.project.name, compileMs, ...performance };
  console.log(`Backdrop measurement: ${JSON.stringify(measurement)}`);
  await testInfo.attach("backdrop-performance.json", { body: JSON.stringify(measurement), contentType: "application/json" });
  expect(performance.valid).toBe(true);
  expect(performance.bytes).toBeGreaterThan(10000);

  // Each edit is compiled by real browser Yosys/Clang, then drawn by Canvas.
  for (const [low, high, display, rgba] of [
    ["e0", "03", "0f", [0, 255, 0, 255]],
    ["e0", "03", "8f", [0, 0, 0, 255]], // configured palette, forced blank
    ["b2", "e5", "07", [69, 49, 96, 255]], // high bit ignored; 5->8 + brightness
    ["b2", "65", "00", [0, 0, 0, 255]], // brightness zero without blank
  ]) {
    await edit(page, "backdrop-rom.v", colorRom(low, high, display));
    solid(await pixels(page), [0, 0, 0, 0]);
    await compile(page);
    await show(page, rgba);
    await reset(page);
    await show(page, rgba);
  }
  // An in-flight frame must not overwrite the paused/reset image.
  await page.evaluate(() => { window.pauseOnFrame = true; });
  await page.locator("#run").click();
  await expect(page.locator("#pause")).toBeDisabled();
  await reset(page);
  expect(await page.evaluate(() => window.circuits.every((c) => c.valid))).toBe(true);
  expect(errors).toEqual([]);
  const base = new URL(page.url());
  for (const request of requests) {
    expect(request.method()).toBe("GET");
    expect(new URL(request.url()).origin).toBe(base.origin);
    expect(new URL(request.url()).pathname).toMatch(/^\/webrtl\//);
  }
});

// Replace only the Video port declaration with the existing trace contract.
// The CPU, bus decode, ROM and PPU wiring below it remain the production RTL.
function observedBoard() {
  return rtl("cpu816-backdrop.v")
    .replace("output video_valid, output [5:0] video_x, video_y,\n    output [23:0] video_rgb, output video_last", `output [7:0] result,
    output reg [23:0] trace_address, output reg [7:0] trace_data,
    output reg [3:0] trace_flags`)
    .replace("    wire [23:0] address;", `    wire video_valid, video_last;
    wire [5:0] video_x, video_y; wire [23:0] video_rgb;
    assign result = {cg_high, inidisp[7], cgaddr[5:0]};
    always @(posedge clk) begin
      if (reset) begin trace_address <= 0; trace_data <= 0; trace_flags <= 0; end
      else begin
        trace_address <= address;
        trace_data <= write ? data_out : data_in;
        trace_flags <= {valid, vpa, vda, write};
      end
    end
    wire [23:0] address;`);
}

test("actual 65C816 writes and PPU pair state follow the executed ROM", async ({ page }) => {
  await load(page);
  await edit(page, "cpu816-backdrop.v", observedBoard());
  await page.locator("#interface").selectOption("cpu816");
  await compile(page);
  const replies = await probe(page, "cpu816", Array.from({ length: 45 }, () => ({ action: "step" })));
  const trace = replies.flatMap((r) => row(r.trace));
  expect(trace).toContainEqual([6, 0x00fffc, 0x00, 10]);
  expect(trace).toContainEqual([7, 0x00fffd, 0x80, 10]);
  expect(trace).toContainEqual([8, 0x008000, 0xd8, 14]);
  expect(trace.filter((r) => r[1] >= 0x2100 && r[1] <= 0x2122 && (r[3] & 1)))
    .toEqual([[15, 0x2100, 0x80, 11], [21, 0x2121, 0, 11],
      [27, 0x2122, 0x1f, 11], [33, 0x2122, 0, 11], [39, 0x2100, 0x0f, 11]]);
  expect(replies[25].count).toBe(0x40); // blank, word 0, low byte expected
  expect(replies[26].count).toBe(0xc0); // low written; high pending; no address advance
  expect(replies[32].count).toBe(0x41); // completed pair; word address now 1
  expect(replies[38].count).toBe(1); // display enabled, address 1
  const repeated = await probe(page, "cpu816", [
    { action: "batch", batchCycles: 27 }, { action: "reset" },
    { action: "batch", batchCycles: 45 },
  ]);
  expect(repeated[1].count).toBe(0x40);
  expect(row(repeated[2].trace)).toEqual(trace);

  // Upper bank bits must reach the device decode: change STA $2100 into
  // STA $012100 by replacing the ROM with another original CPU program.
  const bankRom = `module backdrop_rom(input [15:0] address, output reg [7:0] data);
    always @* case(address)
      16'h8000: data=8'ha9; 16'h8001: data=8'h0f;
      16'h8002: data=8'h8f; 16'h8003: data=8'h00;
      16'h8004: data=8'h21; 16'h8005: data=8'h01;
      16'hfffc: data=0; 16'hfffd: data=8'h80;
      default: data=8'hdb;
    endcase
  endmodule`;
  await edit(page, "backdrop-rom.v", bankRom);
  await compile(page);
  const [bank] = await probe(page, "cpu816", [{ action: "batch", batchCycles: 45 }]);
  expect(row(bank.trace)).toContainEqual([14, 0x012100, 0x0f, 11]);
  expect(bank.count).toBe(0x40);
});

test("PPU latch restart, pair commit, address wrap, inactive writes and reset are deterministic", async ({ page }) => {
  await load(page);
  // Independent device test: explicit stimuli and expected post-edge states.
  // State tuple: INIDISP, CGADD, high-pending, low latch, backdrop word.
  const transactions = [
    { address: "002100", data: "7f", state: [15, 0, 0, 0, 0] },
    { address: "012100", data: "80", state: [15, 0, 0, 0, 0] },
    { address: "002122", data: "ab", write: 0, state: [15, 0, 0, 0, 0] },
    { address: "002122", data: "12", state: [15, 0, 1, 0x12, 0] },
    { address: "002100", data: "07", state: [7, 0, 1, 0x12, 0] },
    { address: "002121", data: "00", state: [7, 0, 0, 0, 0] }, // discard partial pair
    { address: "002122", data: "34", state: [7, 0, 1, 0x34, 0] },
    { address: "7e2122", data: "ff", state: [7, 0, 1, 0x34, 0] },
    { address: "002122", data: "92", state: [7, 1, 0, 0x34, 0x1234] }, // high bit masked
    { address: "002122", data: "ff", state: [7, 1, 1, 0xff, 0x1234] },
    { address: "002122", data: "7f", state: [7, 2, 0, 0xff, 0x1234] }, // word 1 discarded
    { address: "002121", data: "ff", state: [7, 255, 0, 0, 0x1234] },
    { address: "002122", data: "ee", state: [7, 255, 1, 0xee, 0x1234] },
    { address: "002122", data: "7f", state: [7, 0, 0, 0xee, 0x1234] }, // wrap to word 0
    { address: "002122", data: "1f", state: [7, 0, 1, 0x1f, 0x1234] },
    { address: "002123", data: "ff", state: [7, 0, 1, 0x1f, 0x1234] },
    { address: "002122", data: "80", state: [7, 1, 0, 0x1f, 0x001f] },
    { address: "002121", data: "00", state: [7, 0, 0, 0, 0x001f] },
    { address: "002122", data: "ff", state: [7, 0, 1, 0xff, 0x001f] },
    { address: "002122", data: "7f", ppuReset: 1, state: [0x80, 0, 0, 0, 0] },
    { address: "002122", data: "55", state: [0x80, 0, 1, 0x55, 0] },
    { address: "002122", data: "01", state: [0x80, 1, 0, 0x55, 0x155] },
  ];
  const cases = transactions.map((t, i) => `${i}: begin
    address=24'h${t.address}; data=8'h${t.data}; write=1'b${t.write ?? 1};
    ppu_reset=reset || 1'b${t.ppuReset ?? 0}; end`).join("\n");
  await edit(page, "cpu816-backdrop.v", `module cpu816_backdrop (
    input clk, input reset, output [7:0] result,
    output [23:0] trace_address, output [7:0] trace_data, output [3:0] trace_flags
  );
    reg [7:0] phase;
    reg [23:0] address; reg [7:0] data; reg write, ppu_reset;
    wire [7:0] inidisp, cgaddr, cg_low;
    wire cg_high; wire [14:0] backdrop; wire [23:0] rgb;
    backdrop_ppu ppu(.clk(clk), .reset(ppu_reset), .write(write), .address(address),
      .data(data), .inidisp(inidisp), .cgaddr(cgaddr), .cg_low(cg_low),
      .cg_high(cg_high), .backdrop(backdrop), .rgb(rgb));
    assign result=inidisp;
    assign trace_address={cgaddr, cg_high, backdrop};
    assign trace_data=cg_low; assign trace_flags=4'b1000;
    always @* begin
      address=0; data=0; write=0; ppu_reset=reset;
      case(phase) ${cases} default: begin end endcase
    end
    always @(posedge clk) begin
      if (reset) phase<=0; else phase<=phase+1'b1;
    end
  endmodule`);
  await page.locator("#interface").selectOption("cpu816");
  await compile(page);
  const commands = transactions.map(() => ({ action: "step" }));
  const replies = await probe(page, "cpu816", [...commands, { action: "reset" }, ...commands]);
  const states = (results) => results.map((r) => {
    const address = r.trace[1];
    return [r.count, address >>> 16, (address >>> 15) & 1, r.trace[2], address & 0x7fff];
  });
  expect(states(replies.slice(0, transactions.length))).toEqual(transactions.map((t) => t.state));
  expect(replies[transactions.length].count).toBe(0x80);
  expect(replies[transactions.length].trace).toEqual([]);
  expect(states(replies.slice(transactions.length + 1))).toEqual(transactions.map((t) => t.state));
});
