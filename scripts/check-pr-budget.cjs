const { readFileSync, appendFileSync } = require("node:fs");

// Include queue delays in the hard feedback limit. Keep ten seconds for runner
// cleanup after this check; external acceptance still measures aggregate finish.
function assess(run, pages, now, prepare, browser) {
  const jobs = pages.flatMap((page) => page.jobs);
  const created = Date.parse(run.created_at);
  const first = Math.min(...jobs.map((job) => Date.parse(job.started_at)).filter(Number.isFinite));
  const elapsed = (now - created) / 1000;
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
  return { elapsed, initialQueue, runnerSeconds, waits,
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
    `Creation-to-check: ${result.elapsed}s; initial queue: ${result.initialQueue}s (included); completed runner work: ${result.runnerSeconds}s.`,
    "Job start/completion timestamps (execution includes setup and artifact transfers):",
    ...pages.flatMap((page) => page.jobs).map((job) => `- ${job.name}: ${job.started_at} → ${job.completed_at || "running"}; ${job.conclusion || job.status}`),
    "Queue/dependency-ready waits per job (concurrent waits are not additive):",
    ...result.waits.map((wait) => `- ${wait.name}: ${wait.seconds}s`),
    "Budget: <600s creation through aggregate finish, including queue; fail at 590s to reserve cleanup. Each browser: 8min; Playwright: 450s; no retries.",
    "Every PR: edited counter, generic clocks/RAM/Fast-Debug continuity, Canvas/PCM and full SNES compilation with four selected cartridges + CPU reset replay and LoROM/reset/HiROM baselines. This is not exhaustive SNES compatibility.",
    "Review requirement: compiler/runtime/debugger/RTL changes need additional affected-area evidence; see docs/pr-validation.md. Nightly/manual Full regression suite remains independent.",
    `Result: ${result.passed ? "PASS" : "FAIL (component failure, cancellation, skip, invalid clock or time overrun)"}`,
  ].join("\n") + "\n";
  console.log(lines);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines);
  if (!result.passed) process.exitCode = 1;
}
module.exports = { assess };
