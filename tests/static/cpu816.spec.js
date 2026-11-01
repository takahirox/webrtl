const { test, expect } = require("@playwright/test");
const { readFileSync } = require("node:fs");

const rtl = (name) => readFileSync(`examples/cpu816/${name}`, "utf8");
// Observed bus cycles, not an ISA interpreter. Rows are cycle/address/data/flags;
// flags: valid=8, VPA=4, VDA=2, write=1. Idle CPU cycles are omitted.
const expectedTrace = [
  [1, 0x000000, 0xff, 14],
  [3, 0x000100, 0x00, 11], [4, 0x0001ff, 0x00, 11], [5, 0x0001fe, 0x24, 11],
  [6, 0x00fffc, 0x00, 10], [7, 0x00fffd, 0x80, 10],
  [8, 0x008000, 0x18, 14], [10, 0x008001, 0xd8, 14],
  [12, 0x008002, 0xa9, 14], [13, 0x008003, 0x12, 12],
  [14, 0x008004, 0x69, 14], [15, 0x008005, 0x34, 12],
  [16, 0x008006, 0x8f, 14], [17, 0x008007, 0, 12], [18, 0x008008, 0, 12], [19, 0x008009, 1, 12],
  [20, 0x010000, 0x46, 11],
  [21, 0x00800a, 0xa9, 14], [22, 0x00800b, 0, 12],
  [23, 0x00800c, 0xaf, 14], [24, 0x00800d, 0, 12], [25, 0x00800e, 0, 12], [26, 0x00800f, 1, 12],
  [27, 0x010000, 0x46, 10],
  [28, 0x008010, 0xc9, 14], [29, 0x008011, 0x46, 12],
  [30, 0x008012, 0xd0, 14], [31, 0x008013, 6, 12],
  [32, 0x008014, 0xa9, 14], [33, 0x008015, 1, 12],
  [34, 0x008016, 0x8d, 14], [35, 0x008017, 0, 12], [36, 0x008018, 0x20, 12],
  [37, 0x002000, 1, 11],
];
const rows = (trace) => Array.from({ length: trace.length / 4 }, (_, i) => trace.slice(i * 4, i * 4 + 4));

async function observe(page) {
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
        });
      }
    };
  });
}

async function load(page) {
  // Use the same real-compiler smoke test against Pages after deployment.
  await page.goto(process.env.WEBRTL_PUBLIC_URL || "./");
  await page.locator("#example").selectOption("cpu816");
  await page.locator("#load-example").click();
  await expect(page.locator("#source")).toHaveValue(rtl("cpu816-test.v"));
  await expect(page.locator("#files option")).toHaveCount(12);
  await expect(page.locator("#interface")).toHaveValue("cpu816");
  await expect(page.locator("#top")).toHaveValue("cpu816_test");
  await expect(page.locator("#run-help")).toContainText("A result freezes the CPU until Reset.");
}

async function compile(page) {
  const start = Date.now();
  await page.locator("#compile").click();
  await expect(page.locator("#compile")).toBeEnabled({ timeout: 120000 });
  await expect(page.locator("#errors")).toBeHidden();
  await expect(page.locator("#step")).toBeEnabled();
  await expect(page.locator("#cpu-result")).toHaveText("Running (0)");
  await page.locator("#sim-mode").selectOption("debug");
  await expect(page.locator("#sim-mode")).toBeEnabled();
  return Date.now() - start;
}

async function run(page, result = "PASS") {
  await page.locator("#run").click();
  await expect(page.locator("#cpu-result")).toHaveText(result, { timeout: 10000 });
  await page.locator("#pause").click();
  await expect(page.locator("#step")).toBeEnabled();
}

async function reset(page) {
  await page.locator("#reset").click();
  await expect(page.locator("#step")).toBeEnabled();
  await expect(page.locator("#cpu-result")).toHaveText("Running (0)");
  await expect(page.locator("#cpu-trace")).toHaveText("");
  await expect(page.locator("#pause")).toBeDisabled();
}

async function edit(page, name, source) {
  await page.locator("#files").selectOption(name);
  await page.locator("#source").fill(source);
  await expect(page.locator("#step")).toBeDisabled();
}

// Probe actual newly generated Wasm using the production simulator worker.
async function probe(page, commands) {
  return page.evaluate(async (commands) => {
    const worker = new Worker("./simulator-worker.js", { type: "module" });
    let id = 0;
    const call = (message) => new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage({ id: id++, board: "cpu816", ...message });
    });
    try {
      await call({ action: "init", wasm: window.lastWasm });
      await call({ action: "mode", mode: "debug" });
      const results = [];
      for (const command of commands) {
        const result = await call(command);
        results.push({ ...result, trace: Array.from(result.trace) });
      }
      return results;
    } finally { worker.terminate(); }
  }, commands);
}

test("65C816 compiles and executes its ROM with deterministic reset", async ({ page }, testInfo) => {
  const requests = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request));
  await observe(page);
  await load(page);
  const compileMs = await compile(page);
  for (let i = 0; i < 8; i++) {
    await page.locator("#step").click();
    await expect(page.locator("#step")).toBeEnabled();
  }
  await expect(page.locator("#cpu-trace")).toContainText("8: 008000 R 18 VPA=1 VDA=1");
  await run(page);
  await expect(page.locator("#cpu-trace")).toContainText("20: 010000 W 46");
  await expect(page.locator("#cpu-trace")).toContainText("27: 010000 R 46");
  await expect(page.locator("#cpu-trace")).toContainText("37: 002000 W 01");
  const stopped = await page.locator("#cpu-trace").textContent();
  await page.locator("#step").click();
  await expect(page.locator("#step")).toBeEnabled();
  await expect(page.locator("#cpu-trace")).toHaveText(stopped);
  await reset(page);
  await run(page);
  await expect(page.locator("#cpu-trace")).toHaveText(stopped);

  // Reset during Run, delivered atomically between batches to avoid UI races.
  await page.locator("#run").click();
  await page.waitForFunction(() => {
    const button = document.getElementById("reset");
    if (button.disabled || document.getElementById("pause").disabled) return false;
    button.click();
    return true;
  });
  await expect(page.locator("#step")).toBeEnabled();
  await expect(page.locator("#cpu-result")).toHaveText("Running (0)");
  await expect(page.locator("#cpu-trace")).toHaveText("");
  await run(page);

  const commands = [10, 20, 27, 37].flatMap((batchCycles) => [
    { action: "reset" }, { action: "batch", batchCycles },
    { action: "reset" }, { action: "batch", batchCycles: 37 },
  ]);
  const replies = await probe(page, commands);
  for (let i = 0; i < replies.length; i += 4) {
    expect(replies[i].count).toBe(0);
    expect(replies[i].trace).toEqual([]);
    expect(replies[i + 2].cycles).toBe(0);
    expect(replies[i + 3].count).toBe(1);
    expect(rows(replies[i + 3].trace)).toEqual(expectedTrace);
  }
  expect(rows(replies[5].trace)).toContainEqual([20, 0x010000, 0x46, 11]);
  expect(rows(replies[9].trace)).toContainEqual([27, 0x010000, 0x46, 10]);

  // Active-model throughput: every 37-cycle run reaches PASS, with reset and
  // trace sampling included; no post-PASS idle cycles inflate this measurement.
  const performance = await page.evaluate(async () => {
    const unavailable = () => { throw new Error("Unexpected WASI I/O"); };
    const { instance: { exports: sim } } = await WebAssembly.instantiate(window.lastWasm, {
      wasi_snapshot_preview1: { fd_close: unavailable, fd_seek: unavailable, fd_write: unavailable },
    });
    sim._initialize();
    const start = window.performance.now();
    for (let i = 0; i < 10000; i++) {
      sim.sim_reset();
      sim.sim_batch(37);
      if (sim.sim_count() !== 1) throw new Error("Benchmark ROM failed");
    }
    const ms = window.performance.now() - start;
    return { ms, cycles: 370000, cyclesPerSecond: 370000000 / ms, ...window.circuits[0] };
  });
  expect(performance.valid).toBe(true);
  expect(performance.bytes).toBeGreaterThan(10000);
  expect(await page.evaluate(() => window.circuits.length)).toBe(1);
  const measurement = { browser: testInfo.project.name, compileMs, ...performance };
  console.log(`CPU816 measurement: ${JSON.stringify(measurement)}`);
  await testInfo.attach("cpu816-performance.json", { body: JSON.stringify(measurement), contentType: "application/json" });
  expect(errors).toEqual([]);
  const base = new URL(page.url());
  for (const request of requests) {
    expect(request.method()).toBe("GET");
    expect(new URL(request.url()).origin).toBe(base.origin);
    expect(new URL(request.url()).pathname).toMatch(/^\/webrtl\//);
    expect(request.url()).not.toContain("/api/");
  }
});

test("edited instructions, branch and RAM change the actual RTL execution and recover", async ({ page }) => {
  await observe(page);
  await load(page);
  const rom = rtl("cpu816-rom.v");
  await edit(page, "cpu816-rom.v", rom.replace("16'h8005: data = 8'h34", "16'h8005: data = 8'h35"));
  await compile(page);
  await run(page, "FAIL");
  await expect(page.locator("#cpu-trace")).toContainText("010000 W 47");
  await expect(page.locator("#cpu-trace")).toContainText("010000 R 47");
  await expect(page.locator("#cpu-trace")).toContainText("00801a R a9 VPA=1 VDA=1");
  await expect(page.locator("#cpu-trace")).toContainText("002000 W ff");
  await reset(page);
  await run(page, "FAIL");

  await edit(page, "cpu816-rom.v", rom.replace("16'h8012: data = 8'hd0", "16'h8012: data = 8'hf0"));
  await compile(page);
  await run(page, "FAIL");
  await expect(page.locator("#cpu-trace")).toContainText("010000 R 46");
  await expect(page.locator("#cpu-trace")).toContainText("008012 R f0");

  await edit(page, "cpu816-rom.v", rom);
  const memory = rtl("cpu816-memory.v");
  await edit(page, "cpu816-memory.v", memory.replace("<= write_data;", "<= write_data ^ 8'h01;"));
  await compile(page);
  await run(page, "FAIL");
  await expect(page.locator("#cpu-trace")).toContainText("010000 W 46");
  await expect(page.locator("#cpu-trace")).toContainText("010000 R 47");

  await edit(page, "cpu816-memory.v", memory);
  await compile(page);
  await page.locator("#run").click();
  await edit(page, "cpu816-memory.v", "module broken (");
  await expect(page.locator("#pause")).toBeDisabled();
  await expect(page.locator("#cpu-result")).toHaveText("—");
  await page.locator("#compile").click();
  await expect(page.locator("#errors")).toContainText(/cpu816-memory.v.*syntax error/s, { timeout: 120000 });
  await expect(page.locator("#run")).toBeDisabled();
  await edit(page, "cpu816-memory.v", memory);
  await compile(page);
  await run(page);
  const circuits = await page.evaluate(() => window.circuits);
  expect(circuits).toHaveLength(5);
  expect(circuits.every((c) => c.valid)).toBe(true);
});

test("reset vector edits, upper address bits and bounded RTL timeout remain observable", async ({ page }) => {
  await observe(page);
  await load(page);
  const rom = rtl("cpu816-rom.v");
  // A store into unmapped bank 2 cannot alias bank 1 RAM. Readback is still zero.
  await edit(page, "cpu816-rom.v", rom.replace("16'h8009: data = 8'h01", "16'h8009: data = 8'h02"));
  await compile(page);
  await run(page, "FAIL");
  await expect(page.locator("#cpu-trace")).toContainText("020000 W 46");
  await expect(page.locator("#cpu-trace")).toContainText("010000 R 00");

  // Reset vector now starts at STP. Neither C++ nor JS can manufacture PASS.
  await edit(page, "cpu816-rom.v", rom.replace("16'hfffc: data = 8'h00", "16'hfffc: data = 8'h19"));
  await compile(page);
  const replies = await probe(page, [
    { action: "batch", batchCycles: 4095 }, { action: "step" },
    { action: "reset" }, { action: "batch", batchCycles: 4096 },
  ]);
  expect(replies[0].count).toBe(0);
  expect(replies[1].count).toBe(255);
  expect(replies[2].count).toBe(0);
  expect(replies[3].count).toBe(255);
  expect(rows(replies[0].trace)).toContainEqual([8, 0x008019, 0xdb, 14]);
  expect(replies.every((r) => r.trace.length <= 128 * 4)).toBe(true);
  await run(page, "FAIL");
  await reset(page);
  await run(page, "FAIL");
});

test("24-bit memory decode protects ROM, rejects inactive writes and clears RAM on reset", async ({ page }) => {
  await observe(page);
  await load(page);
  const transactions = [
    { address: "010000", expected: 0 }, { address: "01000f", expected: 0 },
    { address: "010000", write: 1, data: "11", expected: 255 },
    { address: "01000f", write: 1, data: "aa", expected: 255 },
    { address: "010000", expected: 0x11 }, { address: "01000f", expected: 0xaa },
    { address: "010010", expected: 255 },
    { address: "020000", write: 1, data: "ee", expected: 255 },
    { address: "010000", expected: 0x11 },
    { address: "010000", valid: 0, write: 1, data: "ee", expected: 255 },
    { address: "010000", expected: 0x11 },
    { address: "008000", write: 1, data: "ee", expected: 255 },
    { address: "008000", expected: 0x18 },
    { address: "018000", expected: 255 },
    { address: "00fffc", expected: 0 }, { address: "00fffd", expected: 0x80 },
    { address: "010000", write: 1, data: "ff", reset: 1, expected: 255 },
    { address: "010000", expected: 0 }, { address: "01000f", expected: 0 },
    { address: "01000f", write: 1, data: "55", expected: 255 },
    { address: "01000f", expected: 0x55 },
  ];
  const cases = transactions.map((t, i) => `${i}: begin
    address = 24'h${t.address}; valid = 1'b${t.valid ?? 1}; write = 1'b${t.write ?? 0};
    data = 8'h${t.data ?? "00"}; memory_reset = reset || 1'b${t.reset ?? 0}; end`).join("\n");
  // This test-only RTL sequencer tests the memory device independently of CPU
  // writes; the example's CPU and ROM remain unmodified in production.
  await edit(page, "cpu816-test.v", `module cpu816_test (
    input clk, input reset, output reg [7:0] result,
    output [23:0] trace_address, output [7:0] trace_data, output [3:0] trace_flags
  );
    assign trace_address = 0; assign trace_data = 0; assign trace_flags = 0;
    reg [7:0] phase;
    reg [23:0] address;
    reg [7:0] data;
    reg valid, write, memory_reset;
    wire [7:0] read_data;
    cpu816_memory memory_bus(.clk(clk), .reset(memory_reset), .valid(valid),
      .write(write), .address(address), .write_data(data), .read_data(read_data));
    always @* begin
      address = 0; data = 0; valid = 0; write = 0; memory_reset = reset;
      case (phase)
        ${cases}
        default: begin end
      endcase
    end
    always @(posedge clk) begin
      if (reset) begin phase <= 0; result <= 0; end
      else begin phase <= phase + 1; result <= read_data; end
    end
  endmodule`);
  await compile(page);
  const replies = await probe(page, [
    ...transactions.map(() => ({ action: "step" })),
    { action: "reset" },
    ...transactions.map(() => ({ action: "step" })),
  ]);
  const expected = transactions.map((t) => t.expected);
  expect(replies.map((r) => r.count)).toEqual([...expected, 0, ...expected]);
});
