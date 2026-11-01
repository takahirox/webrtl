const { readFileSync, appendFileSync } = require("node:fs");

// Include queue delays in the feedback limit. Reserve ten seconds for aggregate
// setup/cleanup and precision; external acceptance measures actual completion.
function assess(run, pages, runnerNow, prepare, browser) {
  const jobs = pages.flatMap((page) => page.jobs);
  const created = Date.parse(run.created_at);
  const first = Math.min(...jobs.map((job) => Date.parse(job.started_at)).filter(Number.isFinite));
  // Actions job timestamps and runner clocks can differ (the first hosted run
  // differed by one hour). Step timestamps come from that job's runner. Measure
  // its local duration, then anchor it to the service's job start. Never subtract
  // an uncalibrated Date.now() from the service's run creation timestamp.
  const aggregate = jobs.find((job) => job.name === "Fast PR checks");
  const serviceStart = Date.parse(aggregate?.started_at);
  const runnerStart = Date.parse(aggregate?.steps?.[0]?.started_at);
  const clockOffsetSeconds = (serviceStart - runnerStart) / 1000;
  const completed = Date.parse(aggregate?.completed_at);
  const localDuration = runnerNow - runnerStart;
  const checkTime = Number.isFinite(completed) ? completed :
    Number.isFinite(localDuration) && localDuration >= 0 ? serviceStart + localDuration : NaN;
  const elapsed = (checkTime - created) / 1000;
  const initialQueue = (first - created) / 1000;
  const runnerSeconds = jobs.reduce((sum, job) => {
    const start = Date.parse(job.started_at), end = Date.parse(job.completed_at);
    return sum + (Number.isFinite(start) && Number.isFinite(end) ? (end - start) / 1000 : 0);
  }, 0);
  const endOf = (selected) => Math.max(created, ...selected.map((job) => Date.parse(job.completed_at)).filter(Number.isFinite));
  const prepared = endOf(jobs.filter((job) => job.name === "PR units and static build"));
  const browsersDone = endOf(jobs.filter((job) => job.name.startsWith("PR browser (")));
  const waits = jobs.map((job) => ({ name: job.name,
    seconds: (Date.parse(job.started_at) - (job.name.startsWith("PR browser (") ? prepared :
      job.name === "Fast PR checks" ? Math.max(prepared, browsersDone) : created)) / 1000 }));
  return { elapsed, initialQueue, runnerSeconds, waits, clockOffsetSeconds, isComplete: Number.isFinite(completed),
    passed: prepare === "success" && browser === "success" &&
      Number.isFinite(initialQueue) && initialQueue >= 0 &&
      Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 590 };
}

if (require.main === module) {
  const run = JSON.parse(readFileSync(".build/pr-run.json"));
  const pages = JSON.parse(readFileSync(".build/pr-jobs.json"));
  const result = assess(run, pages, Date.now(), process.env.PREPARE, process.env.BROWSER);
  const lines = [
    "## Fast PR checks (bounded confidence)",
    `Source: ${process.env.GITHUB_SHA}; unit/build: ${process.env.PREPARE}; browser lanes: ${process.env.BROWSER}`,
    `${result.isComplete ? "Creation-to-result (completed Actions timestamps)" : "Creation-to-check estimate (anchored to Actions job start)"}: ${result.elapsed}s; initial queue: ${result.initialQueue}s (included); completed runner work: ${result.runnerSeconds}s.`,
    `Aggregate service-minus-runner clock offset: ${result.clockOffsetSeconds}s; live duration is measured within the aggregate runner clock, completed duration uses Actions timestamps.`,
    "The live estimate excludes latency before the first setup step; the 10s reserve covers setup/cleanup and timestamp precision. Verify final creation-to-result with the completed aggregate's Actions completed_at, not this live estimate.",
    "Job start/completion timestamps (execution includes setup and artifact transfers):",
    ...pages.flatMap((page) => page.jobs).map((job) => `- ${job.name}: ${job.started_at} → ${job.completed_at || "running"}; ${job.conclusion || job.status}`),
    "Queue/dependency-ready waits per job (concurrent waits are not additive):",
    ...result.waits.map((wait) => `- ${wait.name}: ${wait.seconds}s`),
    "Budget: <600s creation through aggregate finish, including queue; fail at 590s to reserve cleanup. Each browser: 9min; Playwright: 510s; no retries.",
    "Every PR: edited counter, generic clocks/RAM/Fast-Debug continuity, Canvas/PCM and complete SNES compilation with test.sfc pixels, exact DSP PCM, controller input, interrupts/HDMA and CPU startup reset replay. This is not exhaustive SNES compatibility.",
    "Review requirement: compiler/runtime/debugger/RTL changes need additional affected-area evidence; see docs/pr-validation.md. Nightly/manual Full regression suite remains independent.",
    `Result: ${result.passed ? "PASS" : "FAIL (component failure, cancellation, skip, invalid clock or time overrun)"}`,
  ].join("\n") + "\n";
  console.log(lines);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines);
  if (!result.passed) process.exitCode = 1;
}
module.exports = { assess };
