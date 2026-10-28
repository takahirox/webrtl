const { test, expect } = require("@playwright/test");
const { readFileSync, readdirSync } = require("node:fs");

test("runs the precompiled counter under /webrtl/ without a build server", async ({ page }) => {
  const pageErrors = [];
  const requests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));
  // Publish only runtime files, never native compiler sources or diagnostics.
  expect(readdirSync(".build/pages/webrtl").sort()).toEqual(
    ["app.js", "example.v", "index.html", "sim.mjs", "sim.wasm", "style.css"],
  );
  const wasmResponse = page.waitForResponse((response) => response.url().endsWith("/webrtl/sim.wasm"));
  await page.goto("./");
  const step = page.getByRole("button", { name: "Step", exact: true });
  const run = page.getByRole("button", { name: "Run", exact: true });
  const pause = page.getByRole("button", { name: "Pause", exact: true });
  const reset = page.getByRole("button", { name: "Reset", exact: true });
  const count = page.locator("#count");
  await expect(step).toBeEnabled();
  const artifact = await wasmResponse;
  expect(artifact.status()).toBe(200);
  expect(artifact.headers()["content-type"]).toBe("application/wasm");
  expect((await artifact.body()).subarray(0, 4)).toEqual(Buffer.from([0, 97, 115, 109]));
  await expect(page.locator(".notice.demo-only")).toBeVisible();
  await expect(page.locator(".notice.demo-only")).toContainText("not available on GitHub Pages yet");
  const source = page.getByLabel("8-bit counter · counter.v");
  await expect(source).toHaveValue(readFileSync("examples/counter.v", "utf8"));
  await expect(source).toHaveJSProperty("readOnly", true);
  await expect(page.locator("#compile")).toBeHidden();
  await expect(page.locator("#compile")).toBeDisabled();
  await expect(count).toHaveText("0");
  await step.click();
  await expect(count).toHaveText("1");
  await page.evaluate(() => {
    for (let i = 0; i < 254; i++) document.getElementById("step").click();
  });
  await expect(count).toHaveText("255");
  await step.click();
  await expect(count).toHaveText("0");
  await run.click();
  await expect.poll(async () => Number(await count.textContent())).toBeGreaterThanOrEqual(2);
  await expect(step).toBeDisabled();
  await expect(run).toBeDisabled();
  await pause.click();
  const paused = await count.textContent();
  await page.waitForTimeout(350);
  await expect(count).toHaveText(paused);
  await reset.click();
  await expect(count).toHaveText("0");
  await step.click();
  await expect(count).toHaveText("1");
  await run.click();
  await reset.click();
  await page.waitForTimeout(350);
  await expect(count).toHaveText("0");
  await expect(pause).toBeDisabled();
  await expect(run).toBeEnabled();
  // The mode persists on reload and initializes a fresh circuit automatically.
  await page.reload();
  await expect(step).toBeEnabled();
  await expect(count).toHaveText("0");
  expect(pageErrors).toEqual([]);
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) {
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toMatch(/^\/webrtl\//);
    expect(request.url).not.toContain("/api/");
  }
});

test("reports missing precompiled assets and leaves simulation disabled", async ({ page }) => {
  await page.route("**/sim.wasm", (route) => route.abort());
  await page.goto("./");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("#status")).toContainText("Reload the page to try again");
  for (const id of ["compile", "run", "pause", "step", "reset"]) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
  }
  await expect(page.locator("#count")).toHaveText("—");
});
