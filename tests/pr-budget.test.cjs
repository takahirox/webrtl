const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assess, summary } = require("../scripts/check-pr-budget.cjs");

const sha = "a".repeat(40);
const epoch = Date.parse("2026-11-01T00:00:00Z");
const time = (n) => new Date(epoch + n * 1000).toISOString();
function fixture(attempt = 1) {
  const run = { id: 123, run_attempt: attempt, head_sha: sha, created_at: time(-86400), run_started_at: time(0) };
  const expected = { runId: 123, attempt, sha };
  const job = (name, created, start, end) => ({ name, run_id: 123, run_attempt: attempt, head_sha: sha,
    created_at: time(created), started_at: time(start), completed_at: time(end), status: "completed", conclusion: "success" });
  const jobs = [job("PR units and static build", 0, 300, 324),
    job("PR browser (generic)", 326, 350, 450), job("PR browser (snes)", 327, 360, 560),
    job("Fast PR checks", 562, 570, 576)];
  const evaluate = (prepare = "success", browser = "success", now = NaN) => assess(run, [{ jobs }], now, prepare, browser, expected);
  return { run, jobs, expected, evaluate };
}

test("delayed allocation is separate from dependency work and dispatch, never a failure", () => {
  const f = fixture();
  const r = f.evaluate();
  assert.equal(r.passed, true);
  assert.equal(r.elapsed, 576);
  assert.equal(r.initialQueue, 300);
  assert.equal(r.feedback, 276);
  assert.equal(r.workSeconds, 235); // build 24 + longer browser 200 + aggregate 6 + dispatch 5
  assert.equal(r.runnerSeconds, 330);
  assert.deepEqual(r.rows.map((j) => j.wait), [300, 26, 36, 10]);
  assert.deepEqual(r.rows.map((j) => j.queue), [300, 24, 33, 8]);
  assert.deepEqual(r.rows.map((j) => j.dispatch), [0, 2, 3, 2]);
  for (const j of f.jobs) for (const field of ["created_at", "started_at", "completed_at"])
    j[field] = new Date(Date.parse(j[field]) + 3600000).toISOString();
  // Shift job creation too: a dispatch delay plus allocation is still diagnostic.
  const queued = f.evaluate();
  assert.equal(queued.passed, true);
  assert.equal(queued.elapsed, 4176);
  assert.equal(queued.workSeconds, 3835);
  assert.equal(queued.overTarget, true); // delayed job creation is dispatch, not runner queue
  f.jobs[0].created_at = time(0);
  const queueOnly = f.evaluate();
  assert.equal(queueOnly.elapsed, 4176);
  assert.equal(queueOnly.initialQueue, 3900);
  assert.equal(queueOnly.workSeconds, 235);
  assert.equal(queueOnly.overTarget, false);
  assert.equal(queueOnly.passed, true);
});

test("full reruns use their own attempt start, not original creation", () => {
  for (const attempt of [1, 2, 7]) {
    const f = fixture(attempt);
    assert.equal(f.evaluate().elapsed, 576);
    f.run.created_at = "invalid";
    assert.equal(f.evaluate().elapsed, 576);
    assert.equal(f.evaluate().passed, true);
  }
});

test("failed-job/aggregate-only reruns retain same-SHA successes without counting prior work", () => {
  const f = fixture(2);
  f.run.run_started_at = time(86400);
  for (const j of f.jobs.slice(0, 3)) j.run_attempt = 1;
  Object.assign(f.jobs[3], { created_at: time(86400), started_at: time(86402), completed_at: time(86408) });
  let r = f.evaluate();
  assert.equal(r.passed, true);
  assert.equal(r.elapsed, 8);
  assert.equal(r.initialQueue, 2);
  assert.equal(r.workSeconds, 6);
  assert.equal(r.runnerSeconds, 6);
  assert.deepEqual(r.rows.map((j) => j.reused), [true, true, true, false]);
  // Observed API behavior: carried jobs can be relabelled with the new attempt.
  for (const j of f.jobs) j.run_attempt = 2;
  assert.equal(f.evaluate().workSeconds, 6);
  assert.match(summary(f.run, r, sha), /reused successful dependency/);
  f.jobs[1].conclusion = "failure";
  assert.equal(f.evaluate().passed, false);
  assert.equal(f.evaluate().rows[1].reused, false);
});

test("runner clock offsets in either direction use only a local interval", () => {
  for (const offset of [-3600, 3600]) {
    const f = fixture();
    Object.assign(f.jobs[3], { completed_at: null, status: "in_progress", conclusion: null,
      steps: [{ name: "Set up job", started_at: time(570 + offset) }] });
    const live = f.evaluate("success", "success", Date.parse(time(576 + offset)));
    assert.equal(live.elapsed, 576);
    assert.equal(live.workSeconds, 235);
    assert.equal(live.passed, true);
    const backwards = f.evaluate("success", "success", Date.parse(time(569 + offset)));
    assert.equal(backwards.elapsed, null);
    assert.ok(backwards.warnings.length);
    assert.doesNotMatch(summary(f.run, backwards, sha), /NaN|-[0-9]+\.[0-9]+s/);
  }
});

test("missing/inconsistent timestamps report unavailable without inventing time or masking outcomes", () => {
  for (const field of ["started_at", "completed_at", "created_at"]) {
    const f = fixture();
    f.jobs[1][field] = null;
    const r = f.evaluate();
    assert.equal(r.passed, true); // clocks do not decide product correctness
    assert.equal(r.rows[1][field === "created_at" ? "queue" : "duration"], null);
    assert.doesNotMatch(summary(f.run, r, sha), /NaN|-[0-9]+\.[0-9]+s/);
    f.jobs[1].conclusion = "failure";
    assert.equal(f.evaluate().passed, false);
  }
  const f = fixture();
  f.run.run_started_at = null;
  assert.equal(f.evaluate().elapsed, null);
  assert.equal(f.evaluate().initialQueue, null);
  f.jobs[2].completed_at = time(100);
  assert.equal(f.evaluate().rows[2].duration, null);
});

test("genuinely slow work warns about the unchanged <10 minute goal, while timeouts fail", () => {
  const f = fixture();
  f.jobs[2].completed_at = time(1100);
  Object.assign(f.jobs[3], { created_at: time(1101), started_at: time(1102), completed_at: time(1108) });
  const r = f.evaluate();
  assert.equal(r.workSeconds, 774);
  assert.equal(r.overTarget, true);
  assert.equal(r.passed, true);
  assert.match(summary(f.run, r, sha), /OVER TARGET/);
  f.jobs[2].conclusion = "timed_out";
  assert.equal(f.evaluate().passed, false);
});

test("every component failure, missing/duplicate lane or invalid provenance fails closed", () => {
  for (let index = 0; index < 4; ++index) {
    for (const conclusion of ["failure", "skipped", "cancelled", "timed_out", "neutral", null]) {
      const f = fixture(); f.jobs[index].conclusion = conclusion;
      assert.equal(f.evaluate().passed, false, `${index}: ${conclusion}`);
    }
    for (const field of ["run_id", "head_sha", "run_attempt"]) {
      const f = fixture(); f.jobs[index][field] = field === "head_sha" ? "b".repeat(40) : 999;
      assert.equal(f.evaluate().passed, false, field);
    }
    const missing = fixture(); missing.jobs.splice(index, 1);
    assert.equal(missing.evaluate().passed, false);
    const duplicate = fixture(); duplicate.jobs.push({ ...duplicate.jobs[index] });
    assert.equal(duplicate.evaluate().passed, false);
  }
  for (const prepare of ["success", "failure", "skipped", "cancelled"])
    for (const browser of ["success", "failure", "skipped", "cancelled"])
      assert.equal(fixture().evaluate(prepare, browser).passed, prepare === "success" && browser === "success");
  for (const [field, value] of [["id", 999], ["run_attempt", 2], ["head_sha", "b".repeat(40)]]) {
    const f = fixture(); f.run[field] = value;
    assert.equal(f.evaluate().passed, false, field);
  }
});
