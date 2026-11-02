// Deterministic real-browser comparison. Build first; this starts a local server.
const { chromium } = require('@playwright/test');
const { execFileSync, spawn } = require('node:child_process');
const { readFileSync, writeFileSync, mkdirSync, symlinkSync, existsSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { cpus, totalmem, release } = require('node:os');
const path = require('node:path');
const ref = process.argv[2];
if (!ref || !/^[a-zA-Z0-9_.\/-]+$/.test(ref)) throw new Error('Usage: node scripts/benchmark-fast.cjs BASELINE_REF [--snes]');
if (execFileSync('git', ['show', `${ref}:package-lock.json`], { encoding: 'utf8' }) !== readFileSync('package-lock.json', 'utf8'))
  throw new Error('Baseline and current compiler must use the same pinned toolchain for this comparison.');
const baseline = path.resolve('.build/pages/webrtl/fast-baseline');
mkdirSync(baseline, { recursive: true });
for (const name of ['compiler.js', 'compiler-worker.js', 'browser-client.js', 'simulator-worker.js',
  'browser-simulator.cpp', 'debug-runtime.cpp', 'project.js', 'output-contracts.js', 'snes-rom.js']) {
  writeFileSync(path.join(baseline, name), execFileSync('git', ['show', `${ref}:web/${name}`]));
}
if (!existsSync(path.join(baseline, 'tools'))) symlinkSync('../tools', path.join(baseline, 'tools'));
const files = (directory, names) => Object.fromEntries(names.map((n) => [n, readFileSync(`${directory}/${n}`, 'utf8')]));
const sourceFiles = ['compiler.js', 'compiler-worker.js', 'browser-client.js', 'simulator-worker.js',
  'browser-simulator.cpp', 'debug-runtime.cpp', 'fast-backend.js', 'project.js', 'output-contracts.js', 'snes-rom.js'];
const sourceContents = Object.fromEntries(sourceFiles.map((name) => [name, readFileSync(`web/${name}`, 'utf8')]));
const fingerprint = createHash('sha256').update(JSON.stringify(sourceContents)).update(readFileSync('package-lock.json')).digest('hex');
const designs = [
  { name: 'counter', board: 'counter', top: 'counter', clockHz: 10, batches: 2048, warmup: 16,
    files: files('examples', ['counter.v']) },
  { name: 'ram-accumulator', board: 'generic', top: 'debug_ram', clockHz: 1000000, batches: 512, warmup: 16,
    files: files('examples/debug-ram', ['debug-ram.v', 'debug-store.v']) },
  ...(process.argv.includes('--snes') ? [{ name: 'snes', board: 'snes', top: 'snes', frontend: 'slang', clockHz: 21477270,
    batches: 32, warmup: 100, files: files('examples/snes', ['snes.v', 'snes-core.v']) }] : []),
];
(async () => {
  const server = spawn('python3', ['tests/serve_static.py'], { stdio: 'ignore' });
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    for (let i = 0; ; i++) {
      try { await page.goto('http://127.0.0.1:8766/webrtl/'); break; }
      catch (e) { if (i >= 50) throw e; await new Promise((r) => setTimeout(r, 100)); }
    }
    await page.evaluate(async (contents) => {
      for (const [name, expected] of Object.entries(contents))
        if (await (await fetch(`./${name}`)).text() !== expected) throw new Error(`Stale build asset: ${name}; rebuild first`);
    }, sourceContents);
    const cdp = await browser.newBrowserCDPSession();
    const costs = async () => {
      const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
      const cpuSeconds = processInfo.reduce((sum, p) => sum + p.cpuTime, 0);
      const rssBytes = processInfo.reduce((sum, p) => {
        try { return sum + Number(execFileSync('ps', ['-o', 'rss=', '-p', String(p.id)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()) * 1024; }
        catch { return sum; }
      }, 0);
      return { cpuSeconds, sampledBrowserRssBytes: rssBytes };
    };
    const results = [];
    for (const design of designs) {
      const measurements = [];
      for (const variant of ['baseline', 'current']) {
        const before = await costs();
        const compilation = await page.evaluate(async ({ design, variant }) => {
          const { compileBrowser } = await import(variant === 'baseline' ? './fast-baseline/browser-client.js' : './browser-client.js');
          window.sim = await compileBrowser(design, () => {});
          if (design.board === 'snes') await sim._sim_cartridge(new Uint8Array(await (await fetch('./examples/snes/test.sfc')).arrayBuffer()));
          window.prepare = async () => {
            await sim._sim_reset();
            if (design.board === 'generic') await sim._sim_inputs({ enable: '0x1', stimulus: '0x13' });
            for (let i = 0; i < design.warmup; i++) await sim._sim_batch(16384);
          };
          return sim.metrics;
        }, { design, variant });
        const after = await costs();
        for (const engine of variant === 'baseline' ? ['baseline-cxxrtl'] : ['cxxrtl', 'scheduled']) {
          if (variant === 'current') await page.evaluate((backend) => sim._sim_backend(backend), engine);
          const trials = [];
          for (let trial = 0; trial < 3; trial++) {
            await page.evaluate(() => prepare());
            const costBefore = await costs();
            const trialResult = await page.evaluate(async ({ design }) => {
              const started = performance.now();
              for (let i = 0; i < design.batches; i++) {
                if (design.board === 'generic' && i % 64 === 0)
                  await sim._sim_inputs({ stimulus: `0x${((i + 19) & 255).toString(16)}` });
                await sim._sim_batch(16384, design.board === 'snes' && i >= design.batches / 2 ? 2048 : 0);
              }
              const wallMs = performance.now() - started;
              return { wallMs, clocksPerSecond: design.batches * 16384 * 1000 / wallMs,
                wasmMemoryBytes: sim._sim_output().memoryBytes ?? null, engine: sim._sim_output().backend ?? 'baseline-cxxrtl' };
            }, { design });
            const costAfter = await costs();
            if (variant === 'current' && trialResult.engine !== engine)
              throw new Error(`Requested ${engine}, measured ${trialResult.engine}; refusing a mislabeled result`);
            trials.push({ ...trialResult, realTimeRatio: trialResult.clocksPerSecond / design.clockHz,
              browserCpuSeconds: costAfter.cpuSeconds - costBefore.cpuSeconds,
              sampledBrowserRssBytes: costAfter.sampledBrowserRssBytes });
          }
          measurements.push({ engine, compilation, compileAndMountCpuSeconds: after.cpuSeconds - before.cpuSeconds,
            sampledBrowserRssAfterCompileBytes: after.sampledBrowserRssBytes, trials });
        }
        await page.evaluate(() => sim._sim_destroy());
      }
      const result = { name: design.name, top: design.top, clockHz: design.clockHz, files: Object.keys(design.files),
        batchCycles: 16384, measuredBatches: design.batches, warmupBatches: design.warmup, measurements };
      results.push(result); console.log(JSON.stringify(result));
      writeFileSync('.build/fast-benchmark.json', JSON.stringify({ baseline: ref,
        sourceBaseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        sourceWorktreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
        toolchain: Object.fromEntries(['yosys', 'clang'].map((name) => [name, JSON.parse(readFileSync(`node_modules/@yowasp/${name}/package.json`, 'utf8')).version])),
        node: process.version, sourceFingerprint: fingerprint, date: new Date().toISOString(), browser: browser.version(), platform: `${process.platform}/${process.arch}`,
        osRelease: release(), cpu: cpus()[0].model, logicalCpus: cpus().length, physicalMemoryBytes: totalmem(),
        methodology: 'Three sequential warmed trials per engine; production compiler/workers, identical RTL, deterministic input changes. Wall time includes worker/IO/media copying, excludes reset/mount/warmup and UI/audio pacing. CPU is summed CDP browser-process CPU; RSS is a sampled sum (shared pages may be double counted), not peak memory. Baseline has no memory metric. RAM declares a comparison target of 1 MHz; it is not a measured hardware specification. Compile/mount CPU includes reset and cartridge loading. Current variants reuse one compiled module.',
        results }, null, 2) + '\n');
    }
  } finally { await browser?.close(); server.kill(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
