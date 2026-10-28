const { test, expect } = require("@playwright/test");

test("compiles and runs the real counter, edited HDL, and build errors", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  const source = page.getByLabel("8-bit counter · counter.v");
  const compile = page.getByRole("button", { name: "Compile", exact: true });
  const step = page.getByRole("button", { name: "Step", exact: true });
  const run = page.getByRole("button", { name: "Run", exact: true });
  const pause = page.getByRole("button", { name: "Pause", exact: true });
  const reset = page.getByRole("button", { name: "Reset", exact: true });
  const count = page.locator("#count");
  await expect(source).toHaveValue(/module counter/);
  await expect(step).toBeDisabled();
  const example = await source.inputValue();

  // Inspect the artifact too: this must be a WebAssembly module, not a JS fallback.
  const artifactResponse = page.waitForResponse((response) => response.url().endsWith("sim.wasm"));
  await compile.click();
  await expect(step).toBeEnabled({ timeout: 150_000 });
  const artifact = await artifactResponse;
  expect(artifact.headers()["content-type"]).toBe("application/wasm");
  expect((await artifact.body()).subarray(0, 4)).toEqual(Buffer.from([0, 97, 115, 109]));
  await expect(count).toHaveText("0");
  await step.click();
  await expect(count).toHaveText("1");
  // Dispatch the actual Step button handler for every cycle, without mouse overhead.
  await page.evaluate(() => {
    for (let i = 0; i < 254; i++) document.getElementById("step").click();
  });
  await expect(count).toHaveText("255");
  await step.click();
  await expect(count).toHaveText("0");
  await run.click();
  await expect.poll(async () => Number(await count.textContent())).toBeGreaterThanOrEqual(2);
  await expect(step).toBeDisabled();
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

  // A different increment proves the displayed output follows the submitted RTL.
  await run.click();
  await source.fill(example.replace("count + 8'd1", "count + 8'd3"));
  await expect(run).toBeDisabled();
  await expect(pause).toBeDisabled();
  await expect(count).toHaveText("—");
  await compile.click();
  await expect(step).toBeEnabled({ timeout: 150_000 });
  await expect(count).toHaveText("0");
  await step.click();
  await expect(count).toHaveText("3");
  await step.click();
  await expect(count).toHaveText("6");
  await reset.click();
  await expect(count).toHaveText("0");

  await source.fill("module counter ( broken syntax");
  await compile.click();
  await expect(page.getByRole("alert")).toContainText("verilator failed", { timeout: 150_000 });
  await expect(run).toBeDisabled();
  await expect(step).toBeDisabled();
  await expect(compile).toBeEnabled();
  await expect(source).toBeEnabled();

  // A failed compilation must not poison subsequent builds.
  await source.fill(example);
  await compile.click();
  await expect(step).toBeEnabled({ timeout: 150_000 });
  await expect(page.getByRole("alert")).toBeHidden();
  await step.click();
  await expect(count).toHaveText("1");
  expect(pageErrors).toEqual([]);
});
