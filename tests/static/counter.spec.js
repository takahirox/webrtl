const { test, expect } = require("@playwright/test");
const { readFileSync, existsSync } = require("node:fs");

async function observeCompilations(page) {
  // Observe real compiler output before its buffer transfers to the runtime worker.
  // No toolchain, compiled output, or simulator behavior is mocked.
  await page.addInitScript(() => {
    window.compilations = [];
    window.heartbeats = 0;
    setInterval(() => window.heartbeats++, 10);
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (!data.wasm) return;
          let hash = 2166136261;
          for (const byte of data.wasm) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
          window.compilations.push({ valid: WebAssembly.validate(data.wasm), size: data.wasm.length, hash });
        });
      }
    };
  });
}

test("compiles edited RTL and runs fresh Wasm under /webrtl/ with only static GETs", async ({ page, context }) => {
  const pageErrors = [];
  const requests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  context.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));
  expect(existsSync(".build/pages/webrtl/sim.wasm")).toBe(false);
  await observeCompilations(page);
  await page.goto("./");
  const source = page.locator("#source");
  const compile = page.getByRole("button", { name: "Compile", exact: true });
  const step = page.getByRole("button", { name: "Step", exact: true });
  const run = page.getByRole("button", { name: "Run", exact: true });
  const pause = page.getByRole("button", { name: "Pause", exact: true });
  const reset = page.getByRole("button", { name: "Reset", exact: true });
  const count = page.locator("#count");
  const example = readFileSync("examples/counter.v", "utf8");
  await expect(source).toHaveValue(example);
  await expect(source).toHaveJSProperty("readOnly", false);
  await expect(step).toBeDisabled();
  const start = Date.now();
  await compile.click();
  await expect(compile).toBeDisabled();
  await expect(source).toBeDisabled();
  await expect(page.locator("#status")).toContainText(/Loading|Compiling/);
  const heartbeat = await page.evaluate(() => window.heartbeats);
  await expect.poll(() => page.evaluate(() => window.heartbeats)).toBeGreaterThan(heartbeat + 5);
  await expect(step).toBeEnabled({ timeout: 120000 });
  console.log(`First browser compile: ${Date.now() - start} ms`);
  await expect(count).toHaveText("0");
  await step.click();
  await expect(count).toHaveText("1");
  // Wait for each asynchronous worker response before issuing the next cycle.
  await page.evaluate(async () => {
    const button = document.getElementById("step");
    for (let i = 0; i < 254; i++) {
      button.click();
      while (button.disabled) await new Promise(requestAnimationFrame);
    }
  });
  await expect(count).toHaveText("255");
  await step.click();
  await expect(count).toHaveText("0");
  await run.click();
  await expect.poll(async () => Number(await count.textContent())).toBeGreaterThanOrEqual(2);
  await expect(step).toBeDisabled();
  await pause.click();
  await expect(reset).toBeEnabled();
  const paused = await count.textContent();
  await page.waitForTimeout(350);
  await expect(count).toHaveText(paused);
  await reset.click();
  await expect(count).toHaveText("0");
  await run.click();
  await reset.click();
  await page.waitForTimeout(350);
  await expect(count).toHaveText("0");
  await expect(pause).toBeDisabled();

  // Compiling during Run discards the old model even without changing the editor.
  await run.click();
  await compile.click();
  await expect(count).toHaveText("—");
  await expect(pause).toBeDisabled();
  await expect(step).toBeEnabled({ timeout: 120000 });
  await expect(count).toHaveText("0");
  await run.click();
  await source.fill(example.replace("count + 8'd1", "count + 8'd3"));
  await expect(count).toHaveText("—");
  await expect(run).toBeDisabled();
  await expect(pause).toBeDisabled();
  await compile.click();
  await expect(step).toBeEnabled({ timeout: 120000 });
  await step.click();
  await expect(count).toHaveText("3");
  await step.click();
  await expect(count).toHaveText("6");
  await run.click();
  await expect.poll(async () => Number(await count.textContent())).toBeGreaterThan(6);
  await pause.click();
  await reset.click();
  await expect(count).toHaveText("0");

  await source.fill("module counter ( broken syntax");
  await compile.click();
  await expect(page.getByRole("alert")).toContainText(/counter.v.*(syntax error|ERROR)/s, { timeout: 120000 });
  await expect(run).toBeDisabled();
  await expect(step).toBeDisabled();
  await expect(compile).toBeEnabled();
  await expect(source).toBeEnabled();

  // Different sequential logic and a helper module exercise full HDL elaboration.
  await source.fill(`module twist(input [7:0] a, output [7:0] y);
    assign y = {a[6:0], a[7]} ^ 8'h5a;
  endmodule
  module counter(input clk, input reset, output reg [7:0] count);
    wire [7:0] next_count;
    twist helper(count, next_count);
    always @(posedge clk) if (reset) count <= 8'd7; else count <= next_count;
  endmodule`);
  await compile.click();
  await expect(step).toBeEnabled({ timeout: 120000 });
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(count).toHaveText("7");
  await step.click();
  await expect(count).toHaveText("84");
  await step.click();
  await expect(count).toHaveText("242");
  await reset.click();
  await expect(count).toHaveText("7");
  const artifacts = await page.evaluate(() => window.compilations);
  expect(artifacts).toHaveLength(4);
  expect(artifacts.every(({ valid, size }) => valid && size > 100)).toBe(true);
  expect(artifacts[0].hash).toBe(artifacts[1].hash);
  expect(new Set(artifacts.map(({ hash }) => hash)).size).toBe(3);
  expect(pageErrors).toEqual([]);
  expect(requests.some(({ url }) => url.endsWith("yosys.core.wasm"))).toBe(true);
  expect(requests.some(({ url }) => url.endsWith("llvm.core.wasm"))).toBe(true);
  for (const request of requests) {
    expect(request.method).toBe("GET");
    expect(new URL(request.url).origin).toBe("http://127.0.0.1:8766");
    expect(new URL(request.url).pathname).toMatch(/^\/webrtl\//);
    expect(request.url).not.toContain("/api/");
  }
  await page.reload();
  await expect(source).toHaveValue(example);
  await expect(compile).toBeEnabled();
  await expect(count).toHaveText("—");
});

test("reports missing tooling, permits retry, and diagnoses an incompatible interface", async ({ page, context }) => {
  await context.route("**/tools/yosys/*.wasm", (route) => route.abort());
  await page.goto("./");
  const compile = page.getByRole("button", { name: "Compile", exact: true });
  await compile.click();
  await expect(page.getByRole("alert")).toContainText(/failed|fetch/i, { timeout: 120000 });
  await expect(compile).toBeEnabled();
  await expect(page.locator("#step")).toBeDisabled();
  await context.unroute("**/tools/yosys/*.wasm");
  await page.locator("#source").fill("module counter(input clk, input reset, output [3:0] count); assign count=0; endmodule");
  await compile.click();
  await expect(page.getByRole("alert")).toContainText("Counter interface required", { timeout: 120000 });
  await expect(compile).toBeEnabled();
  await page.locator("#source").fill(readFileSync("examples/counter.v", "utf8"));
  await compile.click();
  await expect(page.locator("#step")).toBeEnabled({ timeout: 120000 });
  await expect(page.locator("#count")).toHaveText("0");
});

test("runs the two-file example, retains edits across files, and compiles a selected top and edited helper", async ({ page, context }) => {
  const requests = [];
  const errors = [];
  context.on("request", (request) => requests.push(request));
  page.on("pageerror", (error) => errors.push(error.message));
  await observeCompilations(page);
  await page.goto("./");
  const source = page.locator("#source");
  const files = page.getByLabel("Source file", { exact: true });
  const top = page.getByLabel("Top module", { exact: true });
  const compile = page.getByRole("button", { name: "Compile", exact: true });
  const step = page.getByRole("button", { name: "Step", exact: true });
  const count = page.locator("#count");
  await page.getByLabel("Example", { exact: true }).selectOption("split");
  await page.getByRole("button", { name: "Load example (replaces project)", exact: true }).click();
  const main = readFileSync("examples/split-counter/split-counter.v", "utf8");
  const helper = readFileSync("examples/split-counter/counter-next.v", "utf8");
  await expect(source).toHaveValue(main);
  await expect(top).toHaveValue("split_counter");
  await expect(files.locator("option")).toHaveText(["split-counter.v", "counter-next.v"]);
  await compile.click();
  await expect(top).toBeDisabled();
  await expect(files).toBeDisabled();
  await expect(page.getByLabel("Import local .v files (adds to project)")).toBeDisabled();
  await expect(step).toBeEnabled({ timeout: 120000 });
  await expect(count).toHaveText("0");
  await step.click();
  await expect(count).toHaveText("1");
  // Switching the editor file alone preserves the circuit as well as all edits.
  await files.selectOption("counter-next.v");
  await expect(source).toHaveValue(helper);
  await expect(count).toHaveText("1");
  await source.fill(helper.replace("8'd1", "8'd3"));
  await expect(step).toBeDisabled();
  await files.selectOption("split-counter.v");
  await expect(source).toHaveValue(main);
  await source.fill(main.replace("module split_counter", "module selected_top"));
  await files.selectOption("counter-next.v");
  await expect(source).toHaveValue(helper.replace("8'd1", "8'd3"));
  await top.fill("selected_top");
  await compile.click();
  await expect(step).toBeEnabled({ timeout: 120000 });
  await step.click();
  await expect(count).toHaveText("3");
  await step.click();
  await expect(count).toHaveText("6");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(async () => Number(await count.textContent())).toBeGreaterThan(6);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(step).toBeEnabled();
  const paused = await count.textContent();
  await page.waitForTimeout(350);
  await expect(count).toHaveText(paused);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(count).toHaveText("0");
  const artifacts = await page.evaluate(() => window.compilations);
  expect(artifacts).toHaveLength(2);
  expect(artifacts.every(({ valid, size }) => valid && size > 100)).toBe(true);
  expect(artifacts[0].hash).not.toBe(artifacts[1].hash);
  expect(errors).toEqual([]);
  for (const request of requests) {
    expect(request.method()).toBe("GET");
    expect(new URL(request.url()).origin).toBe("http://127.0.0.1:8766");
    expect(new URL(request.url()).pathname).toMatch(/^\/webrtl\//);
    expect(request.url()).not.toContain("/api/");
  }
  // The original example remains available after working on a multi-file project.
  await page.getByLabel("Example", { exact: true }).selectOption("single");
  await page.getByRole("button", { name: "Load example (replaces project)", exact: true }).click();
  await expect(source).toHaveValue(readFileSync("examples/counter.v", "utf8"));
  await expect(files.locator("option")).toHaveText(["counter.v"]);
  await expect(top).toHaveValue("counter");
});

test("imports multiple files atomically, manages files, and recovers from project and compiler errors", async ({ page }) => {
  await page.goto("./");
  const source = page.locator("#source");
  const files = page.getByLabel("Source file", { exact: true });
  const filename = page.getByLabel("Filename to add or rename");
  const top = page.getByLabel("Top module", { exact: true });
  const input = page.getByLabel("Import local .v files (adds to project)");
  const alert = page.getByRole("alert");
  const compile = page.getByRole("button", { name: "Compile", exact: true });
  const step = page.getByRole("button", { name: "Step", exact: true });
  const original = readFileSync("examples/counter.v", "utf8");
  const upload = (name, content) => ({ name, mimeType: "text/plain", buffer: Buffer.from(content) });
  await expect(source).toHaveValue(original);

  for (const name of ["bad name.v", "not-verilog.txt", "-option.v", "bad.v;"]) {
    await filename.fill(name);
    await page.getByRole("button", { name: "Add file", exact: true }).click();
    await expect(alert).toContainText("Invalid source name");
    await expect(source).toHaveValue(original);
  }
  await filename.fill("counter.v");
  await page.getByRole("button", { name: "Add file", exact: true }).click();
  await expect(alert).toContainText("already exists");

  await filename.fill("scratch.v");
  await page.getByRole("button", { name: "Add file", exact: true }).click();
  await source.fill("// scratch edits");
  await files.selectOption("counter.v");
  await expect(source).toHaveValue(original);
  await files.selectOption("scratch.v");
  await expect(source).toHaveValue("// scratch edits");
  await filename.fill("counter.v");
  await page.getByRole("button", { name: "Rename file", exact: true }).click();
  await expect(alert).toContainText("already exists");
  await filename.fill("../scratch.v");
  await page.getByRole("button", { name: "Rename file", exact: true }).click();
  await expect(alert).toContainText("Invalid source name");
  await filename.fill("renamed.v");
  await page.getByRole("button", { name: "Rename file", exact: true }).click();
  await expect(files).toHaveValue("renamed.v");
  await expect(source).toHaveValue("// scratch edits");
  await page.getByRole("button", { name: "Remove file", exact: true }).click();
  await expect(source).toHaveValue(original);

  // Both an existing-name collision and a duplicate inside one batch are atomic.
  await input.setInputFiles([upload("good.v", "// keep out"), upload("counter.v", "// collision")]);
  await expect(alert).toContainText("already exists");
  await expect(files.locator("option")).toHaveText(["counter.v"]);
  await input.setInputFiles([upload("same.v", "// one"), upload("same.v", "// two")]);
  await expect(alert).toContainText("already exists");
  await expect(files.locator("option")).toHaveText(["counter.v"]);
  await input.setInputFiles(upload("bad name.v", "// invalid"));
  await expect(alert).toContainText("Invalid source name");
  await input.setInputFiles(upload("large.v", "x".repeat(65536)));
  await expect(alert).toContainText("64 KiB");
  await expect(source).toHaveValue(original);
  await expect(files.locator("option")).toHaveText(["counter.v"]);

  // Real local files form a hierarchy with a non-default top-module name.
  const main = readFileSync("examples/split-counter/split-counter.v", "utf8");
  const helper = readFileSync("examples/split-counter/counter-next.v", "utf8");
  await input.setInputFiles(["examples/split-counter/split-counter.v", "examples/split-counter/counter-next.v"]);
  await expect(files.locator("option")).toHaveText(["counter.v", "split-counter.v", "counter-next.v"]);
  await expect(source).toHaveValue(main);
  await top.fill("missing_top");
  await compile.click();
  await expect(alert).toContainText(/missing_top.*not found/is, { timeout: 120000 });
  await expect(source).toHaveValue(main);
  await expect(step).toBeDisabled();
  await top.fill("invalid top");
  await compile.click();
  await expect(alert).toContainText("Invalid top-module name");
  await top.fill("split_counter");
  await files.selectOption("counter-next.v");
  await source.fill("//" + "é".repeat(32768));
  await compile.click();
  await expect(alert).toContainText("64 KiB");
  await expect(source).toHaveValue("//" + "é".repeat(32768));
  await source.fill("module counter_next ( broken syntax");
  await compile.click();
  await expect(alert).toContainText(/counter-next.v.*(syntax error|ERROR)/s, { timeout: 120000 });
  await expect(source).toHaveValue("module counter_next ( broken syntax");
  await source.fill(helper.replace("8'd1", "8'd5"));
  await compile.click();
  await expect(step).toBeEnabled({ timeout: 120000 });
  await expect(alert).toBeHidden();
  await step.click();
  await expect(page.locator("#count")).toHaveText("5");

  // Empty projects and empty new files give fixable errors rather than losing data.
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Remove file", exact: true }).click();
  await expect(source).toBeDisabled();
  await compile.click();
  await expect(alert).toContainText("at least one .v source file");
  await filename.fill("new.v");
  await page.getByRole("button", { name: "Add file", exact: true }).click();
  await compile.click();
  await expect(alert).toContainText('"new.v" is empty');
  await expect(source).toBeEnabled();
});
