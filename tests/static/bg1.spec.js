const { test, expect } = require("@playwright/test");
const { readFileSync } = require("node:fs");
const rtl = (name) => readFileSync(`examples/cpu816-bg1/${name}`, "utf8");
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
  await page.locator("#example").selectOption("bg1");
  await page.locator("#load-example").click();
  await expect(page.locator("#source")).toHaveValue(rtl("cpu816-bg1.v"));
  await expect(page.locator("#files option")).toHaveCount(13);
  await expect(page.locator("#interface")).toHaveValue("video");
  await expect(page.locator("#top")).toHaveValue("cpu816_bg1");
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
async function show(page, expected) {
  await page.locator("#run").click();
  await expect.poll(async () => await pixels(page)).toEqual(expected);
  await page.locator("#pause").click();
  await expect(page.locator("#step")).toBeEnabled();
  expect(await pixels(page)).toEqual(expected);
  expect(expected).toEqual(await page.evaluate(() => window.lastFrame));
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
// Independent pixel specification: no ROM parsing or RTL tile decoder reuse.
// Checker alternates indices 0/1 then 2/3. Only screen tile (1,0) uses
// character 1: horizontal magenta/cyan stripes from palette 1.
function expectedFrame({ tileEdit = false, mapEdit = false, paletteEdit = false, flip = false } = {}) {
  const colors = [[0, 0, 255], paletteEdit ? [0, 255, 0] : [255, 0, 0],
    [0, 255, 0], [255, 255, 255], [0, 0, 0], [255, 255, 0], [0, 255, 255], [255, 0, 255]];
  const frame = [];
  for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) {
    const alternate = x >= 8 && x < 16 && y < 8;
    let pixel = (y % 2) * 2 + x % 2;
    if (tileEdit && y % 8 === 0) pixel = 1;
    if (alternate && !mapEdit) pixel = (y % 2 === (flip ? 1 : 0)) ? 3 : 2;
    const index = pixel === 0 ? 0 : pixel + (alternate ? 4 : 0);
    frame.push(...colors[index], 255);
  }
  return frame;
}
function romEdit(changes) {
  let source = rtl("bg1-rom.v");
  for (const [comment, value] of changes) {
    const expression = new RegExp(`data = 8'h[0-9a-f]{2}; // ${comment}$`, "m");
    expect(source).toMatch(expression);
    source = source.replace(expression, `data = 8'h${value}; // ${comment}`);
  }
  return source;
}

test("CPU BG1 compiles, renders, edits ROM tile/map/palette and resets through Video", async ({ page }, testInfo) => {
  const requests = [], errors = [];
  page.on("request", (request) => requests.push(request));
  page.on("pageerror", (error) => errors.push(error.message));
  await load(page);
  const compileMs = await compile(page);
  const frame = expectedFrame();
  const replies = await probe(page, "video", [
    { action: "batch", batchCycles: 3071 }, { action: "step" },
    { action: "batch", batchCycles: 3071 }, { action: "step" },
    ...[27, 160, 240, 350, 4000].flatMap((batchCycles) => [
      { action: "reset" }, { action: "batch", batchCycles },
      { action: "reset" }, { action: "batch", batchCycles: 6144 },
    ]),
  ]);
  expect(replies[0].frame).toBeNull();
  solid(replies[1].frame, [0, 0, 0, 255]);
  expect(replies[2].frame).toBeNull();
  expect(replies[3].frame).toEqual(frame);
  for (let i = 4; i < replies.length; i += 4) {
    expect(replies[i].cycles).toBe(0);
    expect(replies[i].frame).toBeNull();
    expect(replies[i + 2].frame).toBeNull();
    expect(replies[i + 3].frame).toEqual(frame);
  }
  await page.locator("#step").click();
  await expect(page.locator("#step")).toBeEnabled();
  solid(await pixels(page), [0, 0, 0, 0]);
  await show(page, frame);
  await page.waitForTimeout(80);
  expect(await pixels(page)).toEqual(frame);
  await reset(page);
  await show(page, frame);
  await page.locator("#run").click();
  await page.waitForFunction(() => {
    const reset = document.getElementById("reset");
    if (reset.disabled || document.getElementById("pause").disabled) return false;
    reset.click(); return true;
  });
  await expect(page.locator("#step")).toBeEnabled();
  solid(await pixels(page), [0, 0, 0, 0]);
  await show(page, frame);

  const performance = await page.evaluate(async () => {
    const unavailable = () => { throw new Error("Unexpected WASI I/O"); };
    const { instance: { exports: sim } } = await WebAssembly.instantiate(window.lastWasm, {
      wasi_snapshot_preview1: { fd_close: unavailable, fd_seek: unavailable, fd_write: unavailable },
    });
    sim._initialize(); sim.sim_reset(); sim.sim_batch(6144);
    let start = window.performance.now();
    for (let i = 0; i < 100; i++) sim.sim_batch(3072);
    const ms = window.performance.now() - start;
    start = window.performance.now();
    for (let i = 0; i < 1000; i++) { sim.sim_reset(); sim.sim_batch(250); }
    const activeMs = window.performance.now() - start;
    return { ms, cyclesPerSecond: 307200000 / ms, framesPerSecond: 100000 / ms,
      activeMs, activeCyclesPerSecond: 250000000 / activeMs, ...window.circuits[0] };
  });
  const measurement = { browser: testInfo.project.name, compileMs, ...performance };
  console.log(`BG1 measurement: ${JSON.stringify(measurement)}`);
  await testInfo.attach("bg1-performance.json", { body: JSON.stringify(measurement), contentType: "application/json" });
  expect(performance.valid).toBe(true);
  expect(performance.bytes).toBeGreaterThan(10000);

  for (const [changes, expected] of [
    [[["tile 0 row 0 plane 0", "ff"]], expectedFrame({ tileEdit: true })],
    [[["map entry 1 low", "00"]], expectedFrame({ mapEdit: true })],
    [[["palette 1 low", "e0"], ["palette 1 high", "03"]], expectedFrame({ paletteEdit: true })],
    [[["map entry 1 high; palette 1", "c4"]], expectedFrame({ flip: true })],
    [[["display on, full brightness", "8f"]], Array.from({ length: 3072 }, () => [0, 0, 0, 255]).flat()],
    // Unsupported mode falls back to actual CGRAM[0], preserving backdrop behavior.
    [[["Mode 0, BG1 8x8", "01"]], Array.from({ length: 3072 }, () => [0, 0, 255, 255]).flat()],
  ]) {
    await edit(page, "bg1-rom.v", romEdit(changes));
    solid(await pixels(page), [0, 0, 0, 0]);
    await compile(page);
    await show(page, expected);
    await reset(page);
    await show(page, expected);
  }
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

function observedBoard() {
  return rtl("cpu816-bg1.v")
    .replace("output video_valid, output [5:0] video_x, video_y,\n    output [23:0] video_rgb, output video_last", `output [7:0] result,
    output reg [23:0] trace_address, output reg [7:0] trace_data,
    output reg [3:0] trace_flags`)
    .replace("    wire [23:0] address;", `    wire video_valid, video_last;
    wire [5:0] video_x, video_y; wire [23:0] video_rgb;
    assign result = inidisp;
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

test("actual 65C816 fetches BG1 ROM and writes every documented PPU/VRAM/CGRAM byte", async ({ page }) => {
  await load(page);
  await edit(page, "cpu816-bg1.v", observedBoard());
  await page.locator("#interface").selectOption("cpu816");
  await compile(page);
  // Trace buffers hold 128 transactions; bounded chunks retain all CPU activity.
  const commands = Array.from({ length: 8 }, () => ({ action: "batch", batchCycles: 64 }));
  const replies = await probe(page, "cpu816", [...commands, { action: "reset" }, ...commands]);
  const trace = replies.slice(0, 8).flatMap((r) => row(r.trace));
  expect(trace).toContainEqual([6, 0xfffc, 0, 10]);
  expect(trace).toContainEqual([7, 0xfffd, 0x80, 10]);
  expect(trace).toContainEqual([8, 0x8000, 0xd8, 14]);
  const writes = [[0x2100, 0x80], [0x2121, 0]];
  for (const byte of [0, 0x7c, 0x1f, 0, 0xe0, 3, 0xff, 0x7f, 0, 0, 0xff, 3, 0xe0, 0x7f, 0x1f, 0x7c])
    writes.push([0x2122, byte]);
  writes.push([0x2105, 0], [0x2107, 4], [0x210b, 0], [0x2115, 0x80], [0x2116, 0], [0x2117, 0]);
  for (let y = 0; y < 8; y++) writes.push([0x2118, 0x55], [0x2119, y % 2 ? 0xff : 0]);
  for (let y = 0; y < 8; y++) writes.push([0x2118, y % 2 ? 0 : 0xff], [0x2119, 0xff]);
  writes.push([0x2116, 0], [0x2117, 4], [0x2118, 0], [0x2119, 0], [0x2118, 1], [0x2119, 4], [0x2100, 0xf]);
  const observed = trace.filter((r) => (r[3] & 1) && r[1] >= 0x2100 && r[1] <= 0x2122);
  expect(observed.map((r) => r.slice(1, 3))).toEqual(writes);
  expect(observed.every((r) => r[3] === 11)).toBe(true);
  expect(observed.map((r) => r[0])).toEqual(writes.map((_, i) => 15 + i * 6));
  expect(replies[7].count).toBe(0x0f);
  expect(replies[8].count).toBe(0x80);
  expect(replies.slice(9).flatMap((r) => row(r.trace))).toEqual(trace);
});

test("BG1 device VRAM increments, sparse addresses, CGRAM pairs and reset obey the subset", async ({ page }) => {
  await load(page);
  // This independent device circuit needs only its sequencer and the PPU.
  // Drop unused CPU/ROM files so the long stimulus table fits the same source cap.
  const unused = await page.locator("#files option").evaluateAll((options) =>
    options.map((option) => option.value).filter((name) => !["cpu816-bg1.v", "bg1-ppu.v"].includes(name)));
  for (const name of unused) {
    await page.locator("#files").selectOption(name);
    await page.locator("#remove-file").click();
  }
  // Observe actual RTL outputs after independently specified register stimuli.
  // Test-only ports expose address/pair state; production has no debug interface.
  await edit(page, "bg1-ppu.v", rtl("bg1-ppu.v")
    .replace("output [23:0] rgb", "output [15:0] debug_vmadd, output debug_high, output [23:0] rgb")
    .replace("    integer i;", "    integer i;\n    assign debug_vmadd = vmadd; assign debug_high = cg_high;"));
  // Tuple after each edge: RGB at (0,0), VMADD, CGRAM high-byte pending.
  const transactions = [
    [0x2100, 0x0f, [0, 0, 0]],
    [0x2107, 4, [0, 0, 0]],
    [0x2121, 0, [0, 0, 0]],
    [0x2122, 0, [0, 0, 1]],
    [0x2122, 0x7c, [0x0000ff, 0, 0]], // backdrop blue
    [0x2122, 0x1f, [0x0000ff, 0, 1]],
    [0x2122, 0x80, [0x0000ff, 0, 0]], // palette 1 red; bit 15 discarded
    [0x2115, 0x80, [0x0000ff, 0, 0]],
    [0x2118, 0x80, [0xff0000, 0, 0]], // bit 7 = leftmost, no low increment
    [0x2119, 0, [0xff0000, 1, 0]],
    [0x012118, 0xff, [0xff0000, 1, 0]], // other bank ignored
    [0x2118, 0xff, [0xff0000, 1, 0], 0], // inactive write ignored
    [0x2115, 0, [0xff0000, 1, 0]],
    [0x2118, 0x80, [0xff0000, 2, 0]], // increment after low
    [0x2119, 0xff, [0xff0000, 2, 0]], // high writes current next word
    [0x2116, 0, [0xff0000, 0, 0]],
    [0x2115, 0x81, [0xff0000, 0, 0]],
    [0x2119, 0, [0xff0000, 32, 0]],
    [0x2115, 0x82, [0xff0000, 32, 0]],
    [0x2119, 0xff, [0xff0000, 160, 0]], // unstored write discarded, still increments
    [0x2115, 0x83, [0xff0000, 160, 0]],
    [0x2119, 0xff, [0xff0000, 288, 0]],
    [0x2116, 0xff, [0xff0000, 511, 0]],
    [0x2117, 0xff, [0xff0000, 65535, 0]],
    [0x2115, 0x80, [0xff0000, 65535, 0]],
    [0x2119, 0xff, [0xff0000, 0, 0]], // 16-bit word address wrap; no storage alias
    [0x210b, 1, [0x0000ff, 0, 0]], // character base uses nibble, no alias
    [0x210b, 0x10, [0xff0000, 0, 0]], // BG2 nibble ignored
    [0x2105, 0x10, [0x0000ff, 0, 0]], // 16x16 unsupported -> backdrop
    [0x2105, 0, [0xff0000, 0, 0]],
    [0x2107, 7, [0xff0000, 0, 0]], // size bits ignored; base $0400
    [0x2116, 0, [0xff0000, 0, 0]],
    [0x2117, 4, [0xff0000, 0x400, 0]],
    [0x2118, 2, [0x0000ff, 0x400, 0]], // tile 2 absent, no character alias
    [0x2119, 0, [0x0000ff, 0x401, 0]],
    [0x2107, 8, [0xff0000, 0x401, 0]], // unmapped map reads tile 0
    [0x2121, 0, [0xff0000, 0x401, 0]],
    [0x2122, 0xff, [0xff0000, 0x401, 1]],
    [0x2121, 0, [0xff0000, 0x401, 0]], // discard half pair
    [0x2122, 0xe0, [0xff0000, 0x401, 1]],
    [0x2122, 3, [0xff0000, 0x401, 0]], // palette 0 now green
    [0x2105, 1, [0x00ff00, 0x401, 0]],
    [0x2121, 255, [0x00ff00, 0x401, 0]],
    [0x2122, 0xff, [0x00ff00, 0x401, 1]],
    [0x2122, 0x7f, [0x00ff00, 0x401, 0]], // out-of-range CGRAM discarded, wrap to 0
    [0x2122, 0x1f, [0x00ff00, 0x401, 1]],
    [0x2122, 0, [0xff0000, 0x401, 0]],
    [0x2100, 0x80, [0, 0x401, 0]],
    [0x2118, 0xff, [0, 0, 0], 1, 1], // reset wins over active VRAM write
    [0x2100, 0x0f, [0, 0, 0]], // memories and all controls cleared
    [0x2122, 0x55, [0, 0, 1]],
    [0x2122, 0x7f, [0, 0, 0], 1, 1], // reset wins over pending CGRAM commit
    [0x2100, 0x0f, [0, 0, 0]],
    [0x2107, 4, [0, 0, 0]],
    [0x2121, 1, [0, 0, 0]],
    [0x2122, 0x1f, [0, 0, 1]],
    [0x2122, 0, [0, 0, 0]],
    [0x2118, 0x80, [0xff0000, 1, 0]], // map reset to tile 0, not previous tile 2
    [0x2122, 0x7f, [0, 0, 0], 1, 1],
    [0x2100, 0x0f, [0, 0, 0]],
    [0x2107, 4, [0, 0, 0]],
    [0x2121, 1, [0, 0, 0]],
    [0x2122, 0x1f, [0, 0, 1]],
    [0x2122, 0, [0, 0, 0]], // palette restored: old character bits must be cleared
    [0x2115, 0x80, [0, 0, 0]],
    [0x2118, 0x80, [0xff0000, 0, 0]],
    [0x2119, 0x80, [0, 1, 0]], // index 3; its palette word was reset
    [0x2121, 31, [0, 1, 0]],
    [0x2122, 0xff, [0, 1, 1]],
    [0x2122, 0x7f, [0, 1, 0]],
    [0x2116, 0, [0, 0, 0]],
    [0x2117, 4, [0, 0x400, 0]],
    [0x2118, 0, [0, 0x400, 0]],
    [0x2119, 0x1c, [0xffffff, 0x401, 0]], // palette 7, pixel 3 -> CGRAM[31]
  ];
  const cases = transactions.map(([address, data, , write = 1, reset = 0], i) => `${i}: begin
    address=24'h${address.toString(16)}; data=8'h${data.toString(16)};
    write=1'b${write}; device_reset=reset || 1'b${reset}; end`).join("\n");
  await edit(page, "cpu816-bg1.v", `module cpu816_bg1 (
    input clk, input reset, output [7:0] result,
    output [23:0] trace_address, output [7:0] trace_data, output [3:0] trace_flags
  );
    reg [7:0] phase;
    reg [23:0] address; reg [7:0] data; reg write, device_reset;
    wire [7:0] inidisp; wire [23:0] rgb; wire [15:0] vmadd; wire cg_high;
    bg1_ppu ppu(.clk(clk), .reset(device_reset), .write(write), .address(address),
      .data(data), .x(6'd0), .y(6'd0), .inidisp(inidisp), .rgb(rgb),
      .debug_vmadd(vmadd), .debug_high(cg_high));
    assign result=vmadd[15:8]; assign trace_address=rgb;
    assign trace_data=vmadd[7:0]; assign trace_flags={3'b100, cg_high};
    always @* begin
      address=0; data=0; write=0; device_reset=reset;
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
  const states = (results) => results.map((r) => [r.trace[1], r.count * 256 + r.trace[2], r.trace[3] & 1]);
  for (const actual of [states(replies.slice(0, transactions.length)), states(replies.slice(transactions.length + 1))]) {
    for (let i = 0; i < transactions.length; i++)
      expect(actual[i], `transaction ${i}: $${transactions[i][0].toString(16)}`).toEqual(transactions[i][2]);
  }
  expect(replies[transactions.length].trace).toEqual([]);
});
