const { expect } = require("@playwright/test");

const cpuSources = ["P65C816_pkg.v", "P65C816.v", "mcode.v", "AddrGen.v", "ALU.v",
  "AddSubBCD.v", "BCDAdder.v", "adder4.v", "bit_adder.v"];

// Import regression designs as user projects, without a bundled preset or any
// test-only production API. Call after opening a fresh default counter project.
async function importProject(page, paths, top, board = "counter") {
  await expect(page.locator("#source")).toBeEnabled();
  await page.locator("#file-actions summary").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#remove-file").click();
  await expect(page.locator("#files option")).toHaveCount(0);
  await page.locator("#file-actions summary").click();
  await page.locator("#import-files").setInputFiles(paths);
  await expect(page.locator("#files option")).toHaveText(paths.map((path) => path.split("/").at(-1)));
  await page.locator("#top").fill(top);
  await page.locator(".project-settings summary").click();
  await page.locator("#interface").selectOption(board);
  await page.locator(".project-settings summary").click();
}

module.exports = { importProject, cpuSources };
