const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { snesTitle, genericTitles } = require("./pr-selection.cjs");
test("discovery keeps the bounded PR selection separate from every full browser regression", () => {
  const discover = (config, env = {}) => {
    const clean = { ...process.env };
    delete clean.WEBRTL_PR_SUITE;
    delete clean.WEBRTL_SNES_FIXTURES;
    return JSON.parse(execFileSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test",
      `--config=${config}`, "--list", "--reporter=json"], { env: { ...clean, ...env }, maxBuffer: 4 * 1024 * 1024 }));
  };
  const all = (report) => {
    const visit = (suite) => [...suite.specs, ...(suite.suites || []).flatMap(visit)];
    return report.suites.flatMap(visit);
  };
  const fastSpecs = all(discover("playwright.pr.config.js"));
  const fast = fastSpecs.map((spec) => spec.title);
  assert.equal(fast.length, genericTitles.length + 1);
  for (const title of genericTitles) assert.ok(fast.includes(title), title);
  assert.equal(fast.filter((title) => title === snesTitle).length, 1);

  const full = all(discover("playwright.static.config.js"));
  assert.equal(full.length, 94);
  assert.equal(full.filter((spec) => spec.title.startsWith("full SNES RTL batch ")).length, 26);
  for (const project of ["chromium", "firefox"]) {
    const names = full.flatMap((spec) => spec.tests)
      .filter((entry) => entry.projectName === project)
      .flatMap((entry) => entry.annotations.filter((a) => a.type === "cartridges"))
      .flatMap((a) => a.description.split(","));
    assert.equal(names.length, 260, project);
    assert.equal(new Set(names).size, 260, project);
    assert.equal(names.filter((name) => /^(cpu|irq)-/.test(name)).length, 29, project);
  }
  const selected = fastSpecs.flatMap((spec) => spec.tests)
    .flatMap((entry) => entry.annotations.filter((a) => a.type === "cartridges"))
    .flatMap((a) => a.description.split(","));
  assert.deepEqual(selected, ["test.sfc"]);
  const focused = all(discover("playwright.static.config.js", { WEBRTL_SNES_FIXTURES: "^cpu-binary$" }));
  assert.equal(focused.filter((spec) => spec.title.startsWith("focused SNES RTL batch ")).length, 2);
  assert.equal(focused.filter((spec) => spec.title.startsWith("full SNES RTL batch ")).length, 0);
  assert.throws(() => discover("playwright.pr.config.js", { WEBRTL_SNES_FIXTURES: ".*" }),
    (error) => error.status !== 0 && `${error.stdout}${error.stderr}`.includes("cannot be overridden"));
});
