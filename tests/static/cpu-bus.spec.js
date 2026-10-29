const { test, expect } = require("@playwright/test");
const { readFileSync } = require("node:fs");

const names = ["bus-test.v", "bus-master.v", "bus-rom.v", "bus-ram.v", "bus-decoder.v"];
const rtl = (name) => readFileSync(`examples/cpu-bus/${name}`, "utf8");
const trace = [18, 183, 52, 145, 86, 243, 120, 221, 183, 145, 243, 221, 1];

async function load(page) {
  await page.goto("./");
  await page.locator("#example").selectOption("bus");
  await page.locator("#load-example").click();
  await expect(page.locator("#source")).toHaveValue(rtl("bus-test.v"));
  await expect(page.locator("#files option")).toHaveText(names);
  await expect(page.locator("#top")).toHaveValue("bus_test");
  await expect(page.locator("#interface")).toHaveValue("counter");
}

async function compile(page) {
  await page.locator("#compile").click();
  await expect(page.locator("#compile")).toBeEnabled({ timeout: 120000 });
  await expect(page.locator("#errors")).toBeHidden();
  await expect(page.locator("#step")).toBeEnabled();
  await expect(page.locator("#count")).toHaveText("0");
}

async function steps(page, values) {
  for (const value of values) {
    await page.locator("#step").click();
    // Also wait for the worker reply when consecutive values are identical.
    await expect(page.locator("#step")).toBeEnabled();
    await expect(page.locator("#count")).toHaveText(String(value));
  }
}

async function reset(page) {
  await page.locator("#reset").click();
  await expect(page.locator("#step")).toBeEnabled();
  await expect(page.locator("#count")).toHaveText("0");
}

test("CPU bus compiles five files and exposes the RTL ROM/write/readback trace with deterministic reset", async ({ page, context }) => {
  const requests = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  context.on("request", (request) => requests.push(request));
  await page.addInitScript(() => {
    window.circuits = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.wasm) window.circuits.push({ valid: WebAssembly.validate(data.wasm), bytes: data.wasm.length });
        });
      }
    };
  });
  await load(page);
  // Select a top module independently of filenames and the Counter adapter.
  await page.locator("#source").fill(rtl("bus-test.v").replace("module bus_test", "module selected_bus"));
  await page.locator("#top").fill("selected_bus");
  await compile(page);
  await steps(page, trace);
  await steps(page, [1, 1]); // PASS halts the master until reset.
  // Reset before a write, after a write, after the copy, during verification,
  // and after completion. Each restart must give the same full sequence.
  for (const prefix of [1, 2, 8, 10, 13]) {
    await reset(page);
    await steps(page, trace.slice(0, prefix));
    await reset(page);
    await steps(page, trace);
  }
  await reset(page);
  await page.locator("#run").click();
  await expect(page.locator("#count")).toHaveText("1", { timeout: 10000 });
  await page.locator("#pause").click();
  await expect(page.locator("#step")).toBeEnabled();
  await page.waitForTimeout(250);
  await expect(page.locator("#count")).toHaveText("1");
  await reset(page);
  await page.locator("#run").click();
  // Wait for real simulation progress, then deliver Reset atomically with the
  // enabled check. A separate Playwright click can race the next worker batch,
  // and no individual transaction byte is guaranteed to survive until polling.
  await page.waitForFunction(() => {
    const reset = document.getElementById("reset");
    const cycles = Number.parseInt(document.getElementById("timing").textContent, 10);
    if (!(cycles > 0)
        || document.getElementById("pause").disabled || reset.disabled) return false;
    reset.click();
    return true;
  });
  // The worker reply must acknowledge Reset before stepping the full restart.
  await expect(page.locator("#step")).toBeEnabled();
  await expect(page.locator("#count")).toHaveText("0");
  await expect(page.locator("#timing")).toHaveText("0 cycles · 0.000 simulated seconds");
  await expect(page.locator("#pause")).toBeDisabled();
  await steps(page, trace);
  const circuits = await page.evaluate(() => window.circuits);
  expect(circuits).toHaveLength(1);
  expect(circuits[0].valid).toBe(true);
  expect(circuits[0].bytes).toBeGreaterThan(100);
  expect(errors).toEqual([]);
  for (const request of requests) {
    expect(request.method()).toBe("GET");
    expect(new URL(request.url()).origin).toBe("http://127.0.0.1:8766");
    expect(new URL(request.url()).pathname).toMatch(/^\/webrtl\//);
    expect(request.url()).not.toContain("/api/");
  }
});

test("CPU bus reports faults from edited ROM and RAM and recovers from actionable compile errors", async ({ page }) => {
  await load(page);
  await page.locator("#files").selectOption("bus-rom.v");
  await page.locator("#source").fill(rtl("bus-rom.v").replace("8'h12", "8'h13"));
  await compile(page);
  await steps(page, [19, 182, ...trace.slice(2, 8), 255, 255]);
  await reset(page);
  await steps(page, [19, 182, ...trace.slice(2, 8), 255]);

  await page.locator("#source").fill(rtl("bus-rom.v"));
  await expect(page.locator("#step")).toBeDisabled();
  await page.locator("#files").selectOption("bus-ram.v");
  await page.locator("#source").fill(rtl("bus-ram.v").replace(
    "memory[address] <= write_data;", "memory[address] <= write_data ^ 8'h01;",
  ));
  await compile(page);
  // ROM reads and issued writes are unchanged; only compiled RAM storage is
  // corrupted. The verification must consume RAM read_data and detect failure.
  await steps(page, [...trace.slice(0, 8), 255, 255]);

  await page.locator("#source").fill("module bus_ram ( broken syntax");
  await page.locator("#compile").click();
  await expect(page.locator("#errors")).toContainText(/bus-ram.v.*(syntax error|ERROR)/s, { timeout: 120000 });
  await expect(page.locator("#step")).toBeDisabled();
  await expect(page.locator("#files option")).toHaveText(names);
  await expect(page.locator("#top")).toHaveValue("bus_test");
  await page.locator("#source").fill(rtl("bus-ram.v"));
  await page.locator("#files").selectOption("bus-test.v");
  await page.locator("#source").fill(rtl("bus-test.v").replace("output [7:0] count", "output [6:0] count"));
  await page.locator("#compile").click();
  await expect(page.locator("#errors")).toContainText("Counter interface required", { timeout: 120000 });
  await expect(page.locator("#errors")).toContainText("output unsigned 8-bit count");
  await expect(page.locator("#step")).toBeDisabled();
  await page.locator("#source").fill(rtl("bus-test.v"));
  await compile(page);
  await steps(page, trace);
});

test("compiled bus decoder enforces address boundaries, protection, inactive cycles and RAM reset", async ({ page }) => {
  await load(page);
  // A test-only synthesizable sequencer drives the actual example decoder,
  // ROM and RAM. JS checks observed bytes; it implements no memory device.
  const transactions = [
    { address: "0000", expected: 0x12 },
    { address: "0003", expected: 0x78 },
    { address: "0004", expected: 0 },
    { address: "00ff", expected: 0 },
    { address: "0104", expected: 0 },
    { address: "ffff", expected: 0 },
    { address: "0000", valid: 0, expected: 0 },
    { address: "0000", write: 1, data: "ee", expected: 0 },
    { address: "0000", expected: 0x12 }, // ROM write ignored.
    ...["0100", "0101", "0102", "0103"].map((address) => ({ address, expected: 0 })),
    ...["11", "22", "33", "44"].flatMap((data, i) => [
      { address: `010${i}`, write: 1, data, expected: 0 },
      { address: `010${i}`, expected: parseInt(data, 16) },
    ]),
    { address: "0100", valid: 0, write: 1, data: "ee", expected: 0 },
    { address: "0100", expected: 0x11 }, // Inactive write ignored.
    { address: "0104", write: 1, data: "ee", expected: 0 },
    { address: "0100", expected: 0x11 }, // No low-bit address alias.
    { address: "8100", write: 1, data: "ee", expected: 0 },
    { address: "0100", expected: 0x11 }, // Upper address bits also decoded.
    { address: "0103", write: 1, data: "ee", reset: 1, expected: 0 },
    ...["0100", "0101", "0102", "0103"].map((address) => ({ address, expected: 0 })),
    { address: "0103", write: 1, data: "55", expected: 0 },
    { address: "0103", expected: 0x55 }, // Writable again after reset.
    { address: "0003", expected: 0x78 },
  ];
  const cases = transactions.map((t, i) => `${i}: begin
    address = 16'h${t.address}; valid = 1'b${t.valid ?? 1};
    write = 1'b${t.write ?? 0}; write_data = 8'h${t.data ?? "00"};
    bus_reset = reset || 1'b${t.reset ?? 0}; end`).join("\n");
  await page.locator("#source").fill(`module bus_contract_test(
    input clk, input reset, output reg [7:0] count
  );
    reg [7:0] phase;
    reg valid, write, bus_reset;
    reg [15:0] address;
    reg [7:0] write_data;
    wire [7:0] read_data;
    bus_decoder memory_bus(.clk(clk), .reset(bus_reset), .valid(valid),
      .write(write), .address(address), .write_data(write_data), .read_data(read_data));
    always @* begin
      address = 0; valid = 0; write = 0; write_data = 0; bus_reset = reset;
      case (phase)
        ${cases}
        default: begin end
      endcase
    end
    always @(posedge clk) begin
      if (reset) begin phase <= 0; count <= 0; end
      else begin phase <= phase + 1; count <= read_data; end
    end
  endmodule`);
  await page.locator("#top").fill("bus_contract_test");
  await compile(page);
  await steps(page, transactions.map((t) => t.expected));
  await reset(page);
  await steps(page, transactions.map((t) => t.expected));
});
