const base = require("@playwright/test");
const { appendFileSync } = require("node:fs");

// Observe real worker boundaries without replacing compilation or simulation.
// Full/nightly suites keep their existing fixtures and execution behavior.
const test = process.env.WEBRTL_PR_SUITE ? base.test.extend({
  prProfile: [async ({ page }, use, info) => {
    await page.addInitScript(() => {
      window.prProfile = [];
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          super(url, options);
          const entry = { worker: String(url), phases: [], requests: 0, runtimeMs: 0 };
          window.prProfile.push(entry);
          const pending = new Map();
          let started = performance.now(), previous = started, stage = "startup";
          this.addEventListener("message", ({ data }) => {
            if (pending.has(data.id)) {
              entry.runtimeMs += performance.now() - pending.get(data.id);
              pending.delete(data.id);
            }
            if (data.progress && !data.progress.includes("%")) {
              const now = performance.now();
              entry.phases.push({ stage, ms: now - previous });
              previous = now; stage = data.progress;
            }
            if (data.wasm || data.output !== undefined || data.error) {
              const now = performance.now();
              entry.phases.push({ stage, ms: now - previous });
              entry.ms = now - started;
              if (data.metrics) entry.metrics = data.metrics;
              entry.outcome = data.error ? "error" : "success";
            }
          });
          this.profileRequest = (message) => {
            entry.requests++;
            started = previous = performance.now(); stage = "startup";
            if (message?.action && message.id !== undefined) pending.set(message.id, started);
          };
        }
        postMessage(...args) { this.profileRequest(args[0]); return super.postMessage(...args); }
      };
    });
    await use();
    if (!page.isClosed()) {
      const workers = await page.evaluate(() => window.prProfile || []);
      const profile = { title: info.title, durationMs: info.duration, workers };
      await info.attach("pr-profile", { body: JSON.stringify(profile), contentType: "application/json" });
      const totals = { title: info.title, durationMs: info.duration,
        compileMs: workers.reduce((sum, worker) => sum + (worker.metrics?.compileMs || 0), 0),
        runtimeMs: workers.reduce((sum, worker) => sum + worker.runtimeMs, 0),
        referenceMs: workers.filter((worker) => worker.worker.includes("reference-worker"))
          .reduce((sum, worker) => sum + (worker.ms || 0), 0) };
      console.log("PR profile", JSON.stringify(totals));
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `- ${info.title}: test ${(totals.durationMs / 1000).toFixed(3)}s; completed RTL compilation ${(totals.compileMs / 1000).toFixed(3)}s; runtime worker round trips ${(totals.runtimeMs / 1000).toFixed(3)}s; completed reference work ${(totals.referenceMs / 1000).toFixed(3)}s. Compiler phases and cancelled workers are retained in the profile attachment; concurrent worker intervals are not additive.\n`);
    }
  }, { auto: true }],
}) : base.test;

module.exports = { test, expect: base.expect };
