const { test, expect } = require('../pr-profile.cjs');
const { readFileSync } = require('node:fs');
const { install } = require('../runtime-harness.cjs');

const files = Object.fromEntries(['debug-ram.v', 'debug-store.v'].map((n) =>
  [n, readFileSync(`examples/debug-ram/${n}`, 'utf8')]));

test('scheduled RTL matches reference registers, RAM and inputs at every handoff boundary', async ({ page }) => {
  const metrics = await install(page, { files, top: 'debug_ram', board: 'generic' });
  expect(metrics.fastBackend.supported).toBe(true);
  const result = await page.evaluate(async () => {
    const fast = await circuit.create('scheduled'), reference = await circuit.create('cxxrtl');
    try {
      const { signals } = await reference.call({ action: 'mode', mode: 'debug' });
      const refs = signals.flatMap((s) => Array.from({ length: s.depth }, (_, row) => ({ id: s.id, row })));
      const states = [];
      for (let i = 0; i < 64; ++i) {
        const inputs = { enable: i % 7 === 0 ? '0x0' : '0x1', stimulus: `0x${((i * 73 + 19) & 255).toString(16)}` };
        for (const sim of [fast, reference]) await sim.call({ action: 'inputs', inputs });
        const count = i < 8 ? 1 : (i * 31) % 257 + 1;
        const output = await fast.call({ action: 'batch', batchCycles: count });
        if (output.backend !== 'scheduled') throw new Error('Test silently fell back from the scheduled kernel');
        const expected = await reference.call({ action: 'batch', batchCycles: count });
        const { snapshot } = await fast.call({ action: 'pause' });
        await fast.call({ action: 'mode', mode: 'debug', snapshot });
        const a = await fast.call({ action: 'inspect', refs });
        const b = await reference.call({ action: 'inspect', refs });
        if (JSON.stringify(a.values) !== JSON.stringify(b.values) || a.cycles !== b.cycles ||
          JSON.stringify(output.io) !== JSON.stringify(expected.io)) throw new Error(`State mismatch at iteration ${i}, cycle ${a.cycles}`);
        // Execute an actual Debug step against the reference before returning.
        if (i % 5 === 0) {
          await fast.call({ action: 'step' }); await reference.call({ action: 'step' });
        }
        const paused = await fast.call({ action: 'pause' });
        const resumed = await fast.call({ action: 'mode', mode: 'fast', snapshot: paused.snapshot });
        if (resumed.cycles !== paused.cycles || resumed.snapshot.engine !== 'scheduled') throw new Error('Handoff advanced or changed engines');
        states.push(a.cycles);
      }
      const reset = await fast.call({ action: 'reset' });
      await reference.call({ action: 'reset' });
      await fast.call({ action: 'mode', mode: 'debug' });
      const cleared = await fast.call({ action: 'inspect', refs });
      const expected = await reference.call({ action: 'inspect', refs });
      return { states, reset: reset.cycles, equalReset: JSON.stringify(cleared.values) === JSON.stringify(expected.values) };
    } finally { circuit.destroy(); }
  });
  expect(result.states).toHaveLength(64);
  expect(result.states.at(-1)).toBeGreaterThan(6000);
  expect(result).toMatchObject({ reset: 0, equalReset: true });
});

test('unsupported scheduled transitions report fallback and retain the paused circuit', async ({ page }) => {
  const project = { top: 'cascade', board: 'generic', files: { 'cascade.v': `
    module cascade(input clk, reset, output reg [7:0] q, output reg [7:0] r);
      always @(posedge clk) if (reset) q <= 0; else q <= q + 1;
      always @(posedge q[0] or posedge reset) if (reset) r <= 0; else r <= r + 1;
    endmodule` } };
  const metrics = await install(page, project);
  expect(metrics.fastBackend.supported).toBe(false);
  expect(metrics.fastBackend.reason).toContain('Generated or independent clocks');
  const result = await page.evaluate(async () => {
    const sim = await circuit.create('auto');
    try {
      const before = await sim.call({ action: 'batch', batchCycles: 19 });
      const { snapshot } = await sim.call({ action: 'pause' });
      let message;
      try { await sim.call({ action: 'backend', backend: 'scheduled', snapshot }); }
      catch (error) { message = error.message; }
      const after = await sim.call({ action: 'mode', mode: 'debug', snapshot });
      const step = await sim.call({ action: 'step' });
      return { before, after, step, message };
    } finally { circuit.destroy(); }
  });
  expect(result.message).toContain('Scheduled Fast backend is unavailable');
  expect(result.before).toMatchObject({ backend: 'cxxrtl', cycles: 19 });
  expect(result.after).toMatchObject({ backend: 'cxxrtl', cycles: 19 });
  expect(result.after.io).toEqual(result.before.io);
  expect(result.step.cycles).toBe(20);
});

test('transient asynchronous reset pulses use reference fallback across Fast/Debug handoff', async ({ page }) => {
  const metrics = await install(page, { top: 't', board: 'generic', files: { 'pulse.v': `
    module t(input clk, reset, output reg [7:0] q, r, s);
      always @(posedge clk) if (reset) q <= 0; else q <= q + 1;
      wire q_zero = q[0] == 0;
      always @(posedge clk or posedge q_zero)
        if (q_zero) r <= 0; else if (reset) r <= 0; else r <= r + 1;
      wire r_one = r == 1;
      always @(posedge clk or posedge r_one)
        if (r_one) s <= 8'haa; else if (reset) s <= 0; else s <= s + 1;
    endmodule` } });
  expect(metrics.fastBackend.supported).toBe(false);
  expect(metrics.fastBackend.reason).toContain('Interdependent asynchronous loads');
  const result = await page.evaluate(async () => {
    const fast = await circuit.create('auto'), reference = await circuit.create('cxxrtl');
    try {
      const { signals } = await reference.call({ action: 'mode', mode: 'debug' });
      const refs = ['q', 'r', 's'].map((name) => ({ id: signals.find((s) => s.name === name).id, row: 0 }));
      const read = async (sim) => (await sim.call({ action: 'inspect', refs })).values.map((v) => parseInt(v.hex, 16));
      const states = [];
      // Replay after reset too, alternating real Debug steps with Fast batches.
      for (let replay = 0; replay < 2; ++replay) {
        for (const sim of [fast, reference]) await sim.call({ action: 'reset' });
        for (let cycle = 1; cycle <= 6; ++cycle) {
          if (cycle === 3) await fast.call({ action: 'mode', mode: 'debug' });
          const output = await fast.call(cycle === 3 ? { action: 'step' } : { action: 'batch', batchCycles: 1 });
          await reference.call({ action: 'step' });
          if (output.backend !== 'cxxrtl') throw new Error('Unsafe circuit did not fall back');
          const { snapshot } = await fast.call({ action: 'pause' });
          if (snapshot.cycles !== cycle) throw new Error('Incorrect Fast cycle count');
          if (cycle === 2) {
            let rejected = false;
            try { await fast.call({ action: 'backend', backend: 'scheduled', snapshot }); }
            catch (error) { rejected = error.message.includes('Scheduled Fast backend is unavailable') &&
              error.message.includes('Circuit state is retained'); }
            if (!rejected) throw new Error('Unsafe scheduled transition was not rejected clearly');
          }
          const debug = await fast.call({ action: 'mode', mode: 'debug', snapshot });
          if (debug.cycles !== cycle) throw new Error('Debug handoff advanced the circuit');
          const actual = await read(fast), expected = await read(reference);
          if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`State differs at cycle ${cycle}`);
          states.push(actual);
          const paused = await fast.call({ action: 'pause' });
          const resumed = await fast.call({ action: 'mode', mode: 'fast', snapshot: paused.snapshot });
          if (resumed.cycles !== cycle || resumed.snapshot.engine !== 'cxxrtl') throw new Error('Fast handoff lost fallback state');
        }
      }
      return states;
    } finally { circuit.destroy(); }
  });
  // r briefly reaches 1 at cycle 2 before resetting to 0; s must see that pulse.
  expect(result[1]).toEqual([2, 0, 0xaa]);
  expect(result.slice(6)).toEqual(result.slice(0, 6));
});
