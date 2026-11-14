const { readFileSync, appendFileSync } = require("node:fs");

const names = ["PR units and static build", "PR browser (generic)", "PR browser (snes)", "Fast PR checks"];
const parents = [[], [0], [0], [0, 1, 2]];
const stamp = (value) => typeof value === "string" ? Date.parse(value) : NaN;
const seconds = (end, start) => Number.isFinite(end) && Number.isFinite(start) && end >= start ? (end - start) / 1000 : null;

function assess(run, pages, runnerNow, prepare, browser, expected) {
  const errors = [], warnings = [];
  const jobs = pages.flatMap((page) => page.jobs || []);
  const attemptStart = stamp(run.run_started_at);
  if (!expected || !/^[a-f0-9]{40}$/.test(expected.sha || "") || run.head_sha !== expected.sha ||
      run.id !== Number(expected.runId) || run.run_attempt !== Number(expected.attempt))
    errors.push("Run ID, attempt or source SHA does not match this execution");
  if (prepare !== "success" || browser !== "success") errors.push("A required dependency did not succeed");

  const selected = names.map((name) => {
    const found = jobs.filter((job) => job.name === name);
    if (found.length !== 1) errors.push(`Expected exactly one ${name}; found ${found.length}`);
    return found.length === 1 ? found[0] : null;
  });
  for (const [i, job] of selected.entries()) {
    if (!job) continue;
    if (job.run_id !== run.id || job.head_sha !== run.head_sha ||
        !Number.isInteger(job.run_attempt) || job.run_attempt < 1 || job.run_attempt > run.run_attempt)
      errors.push(`Invalid job provenance: ${job.name}`);
    if (i < 3 ? job.status !== "completed" || job.conclusion !== "success" :
      !(job.status === "in_progress" || (job.status === "completed" && job.conclusion === "success")))
      errors.push(`Required job did not succeed: ${job.name} (${job.conclusion || job.status})`);
  }

  const aggregate = selected[3];
  if (aggregate && aggregate.run_attempt !== run.run_attempt) errors.push("Aggregate is not from the current attempt");
  const completed = stamp(aggregate?.completed_at);
  // Never subtract runner wall time from a service timestamp. Only the local
  // interval since this runner's first step is anchored to its service job start.
  const runnerStart = stamp(aggregate?.steps?.[0]?.started_at);
  const localSeconds = seconds(runnerNow, runnerStart);
  const checkTime = Number.isFinite(completed) ? completed :
    aggregate?.status === "in_progress" && localSeconds !== null ? stamp(aggregate?.started_at) + localSeconds * 1000 : NaN;
  const rows = selected.map((job, i) => {
    const start = stamp(job?.started_at), end = i === 3 ? checkTime : stamp(job?.completed_at);
    const duration = seconds(end, start);
    // Failed-job reruns retain successful dependencies, sometimes even relabelled
    // with the new run_attempt. Old completed intervals are reused evidence,
    // never work or negative queue time in the current attempt.
    const reused = i < 3 && job?.status === "completed" && job.conclusion === "success" &&
      duration !== null && Number.isFinite(attemptStart) && end <= attemptStart;
    const ready = Math.max(attemptStart, ...parents[i].map((p) => stamp(selected[p]?.completed_at)));
    const wait = reused ? null : seconds(start, ready);
    const created = stamp(job?.created_at);
    const queue = reused ? null : seconds(start, Math.max(ready, created));
    const dispatch = reused ? null : seconds(Math.max(created, ready), ready);
    if (!job || duration === null || (!reused && (wait === null || queue === null))) warnings.push(`Unavailable/inconsistent timing: ${names[i]}`);
    return { name: names[i], attempt: job?.run_attempt, outcome: job?.conclusion || job?.status || "missing",
      reused, duration, wait, queue,
      dispatch,
      steps: (job?.steps || []).map((step) => ({ name: step.name, seconds: seconds(stamp(step.completed_at), stamp(step.started_at)) })) };
  });
  const current = rows.map((row, i) => row.reused ? NaN : stamp(selected[i]?.started_at)).filter(Number.isFinite);
  const first = current.length ? Math.min(...current) : NaN;
  const elapsed = seconds(checkTime, attemptStart);
  const initialQueue = seconds(first, attemptStart);
  const feedback = seconds(checkTime, first);
  const paths = rows.map(() => null);
  rows.forEach((row, i) => {
    if (row.reused) paths[i] = 0;
    else if (row.duration !== null && row.wait !== null && row.dispatch !== null && parents[i].every((p) => paths[p] !== null))
      paths[i] = Math.max(0, ...parents[i].map((p) => paths[p])) + row.dispatch + row.duration;
  });
  const workSeconds = paths[3];
  if (elapsed === null) warnings.push("Attempt wall time unavailable; check service timestamps and runner calibration");
  const overTarget = workSeconds !== null && workSeconds >= 600;
  const currentRows = rows.filter((row) => !row.reused);
  return { passed: errors.length === 0, errors, warnings, rows, elapsed, initialQueue, feedback, workSeconds,
    runnerSeconds: Number.isFinite(attemptStart) && currentRows.every((row) => row.duration !== null) ?
      currentRows.reduce((sum, row) => sum + row.duration, 0) : null,
    overTarget, isComplete: Number.isFinite(completed) };
}

const fmt = (value) => value === null ? "unavailable" : `${value.toFixed(3)}s`;
function summary(run, result, checkoutSha) {
  return [
    "## Fast PR checks (bounded confidence)",
    `Attempt: ${run.run_attempt}; source SHA: ${run.head_sha}; tested checkout/build SHA: ${checkoutSha}`,
    `Result: ${result.passed ? "PASS" : "FAIL"}; timing target: ${result.overTarget ? "OVER TARGET — investigate performance" : result.workSeconds === null ? "unavailable" : "within <600s"}.`,
    `Attempt start → ${result.isComplete ? "completed aggregate" : "live check estimate"}: ${fmt(result.elapsed)}; initial dispatch/allocation wait: ${fmt(result.initialQueue)}.`,
    `First runner → result (includes downstream dependency-ready waits): ${fmt(result.feedback)}; work/dependency critical path (execution + dispatch, allocation queues excluded): ${fmt(result.workSeconds)}; summed current-attempt runner time: ${fmt(result.runnerSeconds)}.`,
    "Timing is diagnostic, not a test-pass gate. Existing job/test timeouts remain enforced. Queue delays or a timing overrun alone never require human approval; normal automated reruns are supported.",
    "Live aggregate duration uses only a runner-local interval anchored to its Actions start; setup/cleanup after this snapshot is not included. Missing/inconsistent clocks are unavailable, never negative elapsed values.",
    "Job timings: duration; dependency-ready → start wait; runner queue after job creation/readiness; ready → job creation dispatch. Parallel waits are not additive. Reused dependencies are excluded from this attempt's work.",
    ...result.rows.flatMap((row) => [
      `- ${row.name}: ${row.outcome}; attempt ${row.attempt ?? "unknown"}${row.reused ? " (reused successful dependency)" : ""}; duration ${fmt(row.duration)}; wait ${fmt(row.wait)}; queue ${fmt(row.queue)}; dispatch ${fmt(row.dispatch)}`,
      ...row.steps.map((step) => `  - ${step.name}: ${fmt(step.seconds)} (step-local clock)`),
    ]),
    ...result.errors.map((error) => `- ERROR: ${error}`),
    ...result.warnings.map((warning) => `- Timing warning: ${warning}`),
    "Real generic/verification, pixels/PCM and complete-console SNES checks remain required. Full nightly/manual cartridge and Firefox coverage remains separate. See docs/pr-validation.md.",
  ].join("\n") + "\n";
}

if (require.main === module) {
  const run = JSON.parse(readFileSync(".build/pr-run.json"));
  const pages = JSON.parse(readFileSync(".build/pr-jobs.json"));
  const result = assess(run, pages, Date.now(), process.env.PREPARE, process.env.BROWSER, {
    sha: process.env.SOURCE_SHA, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  const lines = summary(run, result, process.env.GITHUB_SHA);
  console.log(lines);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines);
  if (result.overTarget || result.warnings.length) console.log("::warning::Fast PR timing needs investigation; see the job summary.");
  if (!result.passed) process.exitCode = 1;
}
module.exports = { assess, summary };
