const { test, expect } = require("@playwright/test");
const { importProject } = require("../import-project.cjs");

async function noPageOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

// One real counter compile per browser covers layout and critical state visibility;
// the existing project/modes/output suites exercise the detailed runtime paths.
test("workspace keeps editing central, reflows panes and exposes compilation failures", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("./");
  const source = page.locator("#source");
  const details = page.locator("#detail-panel");
  const filename = page.getByRole("textbox", { name: "Filename", exact: true });
  const add = page.getByRole("button", { name: "Add file", exact: true });
  await expect(source).toBeEnabled();
  await expect(page.locator(".project-settings")).not.toHaveAttribute("open");
  await expect(page.locator("#compile-notice")).toBeHidden();
  await expect(filename).toBeHidden();
  await expect(page.locator("#rename-file")).toBeHidden();
  await expect(page.locator("#remove-file")).toBeHidden();
  await expect(page.locator("#run-help")).toBeHidden();
  await expect(details).not.toHaveAttribute("open");
  await expect(page.getByRole("region", { name: "Editor", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Simulation", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import local source files", exact: true })).toBeVisible();
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Add file", exact: true })).toBeVisible();
  await expect(filename).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();
  const project = await page.locator(".project-pane").boundingBox();
  const editor = await page.locator(".editor-pane").boundingBox();
  const simulation = await page.locator(".simulation-pane").boundingBox();
  const detail = await page.locator(".detail-pane").boundingBox();
  expect(project.x + project.width).toBeLessThanOrEqual(editor.x);
  expect(editor.x + editor.width).toBeLessThanOrEqual(simulation.x);
  expect(project.y).toBe(editor.y);
  expect(editor.y).toBe(simulation.y);
  expect(editor.width).toBeGreaterThan(simulation.width * 1.3);
  expect(editor.width).toBeGreaterThan(project.width * 2);
  expect(detail.y).toBeGreaterThanOrEqual(editor.y + editor.height);
  expect(detail.height).toBeLessThan(110);
  expect(detail.y + detail.height).toBeLessThanOrEqual(900);
  await noPageOverflow(page);
  for (const id of ["compile", "run", "pause", "step", "reset", "sim-mode", "example"]) {
    await expect(page.locator(`#${id}`)).toBeInViewport();
  }

  // The flat file switcher retains text and native textarea selection/scroll.
  await importProject(page, ["tests/fixtures/split-counter/split-counter.v",
    "tests/fixtures/split-counter/counter-next.v"], "split_counter");
  await expect(page.locator("#files option")).toHaveText(["split-counter.v", "counter-next.v"]);
  const edited = (await source.inputValue()) + "\n// in-memory edit";
  await source.fill(edited);
  await source.evaluate((el) => { el.setSelectionRange(12, 20, "backward"); el.scrollTop = 20; });
  const scroll = await source.evaluate((el) => el.scrollTop);
  await page.locator("#files").selectOption("counter-next.v");
  await page.locator("#files").selectOption("split-counter.v");
  await expect(source).toHaveValue(edited);
  expect(await source.evaluate((el) => [el.selectionStart, el.selectionEnd, el.selectionDirection, el.scrollTop]))
    .toEqual([12, 20, "backward", scroll]);
  await source.focus();
  await expect(source).toBeFocused();
  await page.keyboard.press("ArrowRight");
  expect(await source.evaluate((el) => el.selectionStart)).toBe(20);
  // Add/rename use a native modal; Enter submits and focus returns to the editor.
  await add.click();
  await filename.fill("scratch.v");
  await filename.press("Enter");
  await expect(source).toBeFocused();
  await source.fill("// retained scratch");
  await page.locator("#file-actions summary").click();
  await page.getByRole("button", { name: "Rename file", exact: true }).click();
  await expect(filename).toBeFocused();
  await filename.fill("renamed.v");
  await filename.press("Enter");
  await expect(source).toHaveValue("// retained scratch");
  await expect(source).toBeFocused();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain('Remove "renamed.v"');
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Remove file", exact: true }).click();
  await expect(source).toHaveValue("// retained scratch");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove file", exact: true }).click();
  await expect(page.locator("#files")).toBeFocused();
  await expect(page.locator("#files option")).toHaveText(["split-counter.v", "counter-next.v"]);
  await expect(source).toHaveValue(edited);

  // Import has a discoverable keyboard button and adds without replacing edits.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import local source files", exact: true }).click();
  await (await chooser).setFiles({ name: "imported.v", mimeType: "text/plain", buffer: Buffer.from("// imported") });
  await expect(source).toHaveValue("// imported");
  await page.locator("#files").selectOption("split-counter.v");
  await expect(source).toHaveValue(edited);
  await page.locator("#files").selectOption("imported.v");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#remove-file").click();
  await expect(page.locator("#files option")).toHaveCount(2);

  // Choosing an example never replaces sources; dismissing replacement is safe.
  await page.locator("#example").selectOption("single");
  await expect(source).toHaveValue(edited);
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Replace all project files");
    expect(dialog.message()).toContain("edits will be lost");
    await dialog.dismiss();
  });
  await page.locator("#load-example").click();
  await expect(source).toHaveValue(edited);
  await expect(page.locator("#files option")).toHaveText(["split-counter.v", "counter-next.v"]);
  await page.screenshot({ path: testInfo.outputPath("workspace-wide.png") });

  await page.locator("#compile").click();
  await expect(page.locator("#compile-notice")).toBeVisible();
  await expect(page.locator("#compile-notice")).toContainText("~185 MB");
  await expect(page.locator("#compile-notice")).toContainText("hundreds of MiB");
  await expect(page.locator("#status")).toContainText(/Loading|Compiling/);
  await expect(page.locator("#status")).toBeInViewport();
  await expect(page.locator("#example")).toBeDisabled();
  await expect(page.locator("#step")).toBeEnabled({ timeout: 120000 });
  await expect(page.locator("#status")).toContainText("Ready");
  await expect(page.locator("#compile-notice")).toBeHidden();
  await expect(details).not.toHaveAttribute("open");
  await page.locator("#step").click();
  await expect(page.locator("#count")).toHaveText("1");

  await page.setViewportSize({ width: 768, height: 900 });
  const narrowEditor = await page.locator(".editor-pane").boundingBox();
  const narrowSimulation = await page.locator(".simulation-pane").boundingBox();
  expect(narrowEditor.width).toBeGreaterThan(500);
  expect(narrowSimulation.y).toBeGreaterThanOrEqual(narrowEditor.y + narrowEditor.height);
  await noPageOverflow(page);
  await page.locator("#run").click();
  await page.locator("#pause").click();
  await expect(page.locator("#step")).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("workspace-narrow.png"), fullPage: true });

  // A collapsed diagnostic log cannot hide a critical error, even after reflow.
  await expect(page.locator("#compiler-details")).not.toHaveAttribute("open");
  await source.fill("module split_counter ( broken syntax");
  await page.locator("#compile").click();
  await expect(page.getByRole("alert")).toContainText(/syntax error|ERROR/, { timeout: 120000 });
  await expect(details).toHaveAttribute("open", "");
  await expect(page.getByRole("alert")).toBeInViewport();
  await expect(page.locator("#status")).toContainText("Failed");
  await expect(page.locator("#run")).toBeDisabled();
  await expect(source).toBeEnabled();
  await expect(page.locator("#compile")).toBeEnabled();
  await noPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("workspace-error.png"), fullPage: true });

  // Board-specific controls follow the selected example; no decorative outputs.
  page.once("dialog", (dialog) => dialog.accept());
  for (const [example, video, audio, cartridge] of [
    ["snes", true, true, true], ["video", true, false, false],
    ["audio", false, true, false], ["single", false, false, false],
  ]) {
    await page.locator("#example").selectOption(example);
    await page.locator("#load-example").click();
    for (const [id, visible] of [["video", video], ["audio-status", audio], ["cartridge-controls", cartridge]]) {
      await expect(page.locator(`#${id}`)).toBeVisible({ visible });
    }
    if (cartridge) {
      await expect(page.getByText("Use only ROMs", { exact: false })).toBeHidden();
      await page.getByText("Cartridge & controller help", { exact: true }).click();
      await expect(page.getByText("Use only ROMs", { exact: false })).toBeVisible();
      await page.getByRole("link", { name: "Focus canvas", exact: true }).click();
      await expect(page.locator("#video")).toBeFocused();
      await expect(page.locator("#cartridge")).toBeVisible();
    }
    await noPageOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await noPageOverflow(page);
  for (const id of ["compile", "run", "pause", "step", "reset", "sim-mode", "example"]) {
    await expect(page.locator(`#${id}`)).toBeInViewport();
  }
  await page.locator("#file-actions").evaluate((el) => { el.open = false; });
  await add.click();
  await expect(filename).toBeInViewport();
  await expect(filename).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();
  await noPageOverflow(page);
  expect(errors).toEqual([]);
});
