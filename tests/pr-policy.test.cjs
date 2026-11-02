const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { snesTitle, genericTitles } = require("./pr-selection.cjs");
const { assess } = require("../scripts/check-pr-budget.cjs");

test("fast aggregate rejects failed, skipped, cancelled and over-budget runs", () => {
  const run = { created_at: "2026-11-01T00:00:00Z" };
  const pages = [{ jobs: [{ name: "PR units and static build", started_at: "2026-11-01T00:00:03Z", completed_at: "2026-11-01T00:00:13Z" },
    { name: "Fast PR checks", started_at: "2026-11-01T00:00:14Z", completed_at: null,
      steps: [{ started_at: "2026-11-01T00:00:14Z" }] }] }];
  const start = Date.parse(run.created_at);
  for (const prepare of ["success", "failure", "skipped", "cancelled"]) {
    for (const browser of ["success", "failure", "skipped", "cancelled"]) {
      assert.equal(assess(run, pages, start + 589000, prepare, browser).passed,
        prepare === "success" && browser === "success");
    }
  }
  assert.equal(assess(run, pages, start + 590000, "success", "success").passed, false);
  assert.equal(assess(run, pages, start + 600000, "success", "success").passed, false);
  assert.equal(assess({ created_at: "invalid" }, pages, start, "success", "success").passed, false);
  assert.equal(assess(run, [{ jobs: [] }], start + 1000, "success", "success").passed, false);
  assert.equal(assess(run, pages, start + 400000, "success", "success").initialQueue, 3);
  const timings = [{ jobs: [
    { name: "PR units and static build", started_at: "2026-11-01T00:00:03Z", completed_at: "2026-11-01T00:00:13Z" },
    { name: "PR browser (generic)", started_at: "2026-11-01T00:00:15Z", completed_at: "2026-11-01T00:01:00Z" },
    { name: "PR browser (snes)", started_at: "2026-11-01T00:00:17Z", completed_at: "2026-11-01T00:05:00Z" },
    { name: "Fast PR checks", started_at: "2026-11-01T00:05:02Z", completed_at: null,
      steps: [{ started_at: "2026-11-01T00:05:02Z" }] },
  ] }];
  const clocks = assess(run, timings, start + 304000, "success", "success");
  assert.deepEqual(clocks.waits.map((wait) => wait.seconds), [3, 2, 4, 2]);
  assert.equal(clocks.runnerSeconds, 338);
});

test("aggregate calibrates runner clock skew against Actions and agrees with completed timestamps", () => {
  // Actual failed run 41288950303: the runner/step clock was one hour behind
  // the Actions job clock. Keep this failure as evidence, not fast acceptance.
  const run = { created_at: "2026-11-01T09:27:34Z" };
  const jobs = [
    { name: "PR units and static build", started_at: "2026-11-01T09:27:36Z", completed_at: "2026-11-01T09:27:57Z" },
    { name: "PR browser (generic)", started_at: "2026-11-01T09:27:59Z", completed_at: "2026-11-01T09:29:37Z" },
    { name: "PR browser (snes)", started_at: "2026-11-01T09:27:59Z", completed_at: "2026-11-01T09:36:00Z" },
    { name: "Fast PR checks", started_at: "2026-11-01T09:36:02Z", completed_at: null,
      steps: [{ started_at: "2026-11-01T08:36:03Z" }] },
  ];
  const live = assess(run, [{ jobs }], Date.parse("2026-11-01T08:36:06.435Z"), "success", "cancelled");
  assert.equal(live.elapsed, 511.435);
  assert.equal(live.clockOffsetSeconds, 3599);
  assert.equal(live.initialQueue, 2);
  assert.deepEqual(live.waits.map((wait) => wait.seconds), [2, 2, 2, 2]);
  assert.equal(live.runnerSeconds, 600);
  assert.equal(live.passed, false);
  // The identical local interval works with a clock ahead of the service too.
  jobs[3].steps[0].started_at = "2026-11-01T10:36:03Z";
  assert.equal(assess(run, [{ jobs }], Date.parse("2026-11-01T10:36:06.435Z"), "success", "success").elapsed, live.elapsed);
  assert.equal(assess(run, [{ jobs }], Date.parse("2026-11-01T10:36:01Z"), "success", "success").passed, false);
  jobs[3].completed_at = "2026-11-01T09:36:09Z";
  const finished = assess(run, [{ jobs }], NaN, "success", "cancelled");
  assert.equal(finished.elapsed, 515);
  assert.equal(finished.runnerSeconds, 607);
  assert.equal(finished.passed, false);
  jobs[3].completed_at = null;
  jobs[3].steps = [];
  assert.equal(assess(run, [{ jobs }], Date.now(), "success", "success").passed, false);
});

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
  assert.equal(full.length, 88);
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
