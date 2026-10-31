const { test, expect } = require("@playwright/test");
const { execFileSync } = require("node:child_process");
const { readFileSync, readdirSync } = require("node:fs");

test("serves this checkout's UI, SNES sources and cartridge under /webrtl/", async ({ request }) => {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (process.env.GITHUB_SHA) expect(commit).toBe(process.env.GITHUB_SHA);
  const info = await request.get("build-info.json");
  expect(info.ok()).toBe(true);
  expect(await info.json()).toEqual({ commit });

  const index = await request.get("./");
  expect(index.ok()).toBe(true);
  expect(await index.text()).toBe(
    readFileSync("web/index.html", "utf8").replace('data-mode="local"', 'data-mode="browser"')
  );
  const assets = [
    ...readdirSync("web").filter((name) => /\.(js|css|cpp|txt)$/.test(name))
      .map((name) => [name, `web/${name}`]),
    ...["snes.v", "snes-core.v", "test.sfc", "boot/spc700-boot-rom.bin"]
      .map((name) => [`examples/snes/${name}`, `examples/snes/${name}`]),
  ];
  for (const [url, source] of assets) {
    const response = await request.get(url);
    expect(response.ok(), url).toBe(true);
    expect((await response.body()).equals(readFileSync(source)), url).toBe(true);
  }
});

test("loads the SNES project and compiles an edited counter into fresh browser Wasm", async ({ page, context }) => {
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  context.on("request", (request) => requests.push(request));
  await page.addInitScript(() => {
    window.compiledWasm = false;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.wasm) window.compiledWasm = WebAssembly.validate(data.wasm);
        });
      }
    };
  });
  await page.goto("./");
  const source = page.locator("#source");
  await expect(source).toHaveValue(readFileSync("examples/counter.v", "utf8"));
  const example = page.getByLabel("Example", { exact: true });
  await expect(example.locator('option[value="snes"]')).toHaveText("SNES · experimental base console RTL");
  await example.selectOption("snes");
  await page.getByRole("button", { name: "Load example (replaces project)", exact: true }).click();
  await expect(source).toHaveValue(readFileSync("examples/snes/snes.v", "utf8"));
  await expect(page.getByLabel("Source file", { exact: true }).locator("option"))
    .toHaveText(["snes.v", "snes-core.v"]);
  await expect(page.locator("#cartridge-controls")).toBeVisible();
  await expect(page.locator("#frontend")).toHaveValue("slang");

  // Keep full console compilation/cartridge sweeps in the full regression workflow.
  await example.selectOption("single");
  await page.getByRole("button", { name: "Load example (replaces project)", exact: true }).click();
  const counter = readFileSync("examples/counter.v", "utf8");
  await expect(source).toHaveValue(counter);
  await source.fill(counter.replace("count + 8'd1", "count + 8'd3"));
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  const step = page.getByRole("button", { name: "Step", exact: true });
  await expect(step).toBeEnabled({ timeout: 90_000 });
  await expect(page.locator("#count")).toHaveText("0");
  await step.click();
  await expect(page.locator("#count")).toHaveText("3");
  await step.click();
  await expect(page.locator("#count")).toHaveText("6");
  expect(await page.evaluate(() => window.compiledWasm)).toBe(true);
  expect(errors).toEqual([]);
  await expect(page.getByRole("alert")).toBeHidden();
  expect(requests.some((request) => request.url().endsWith("yosys.core.wasm"))).toBe(true);
  expect(requests.some((request) => request.url().endsWith("llvm.core.wasm"))).toBe(true);
  for (const request of requests) {
    expect(request.method()).toBe("GET");
    expect(new URL(request.url()).origin).toBe("http://127.0.0.1:8766");
    expect(new URL(request.url()).pathname).toMatch(/^\/webrtl\//);
  }
});
