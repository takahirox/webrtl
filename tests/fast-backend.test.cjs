const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const load = () => import('data:text/javascript;base64,' + Buffer.from(readFileSync('web/fast-backend.js')).toString('base64'));
function fixture() {
  return { ports: { clk: { direction: 'input', bits: [2] }, reset: { direction: 'input', bits: [3] } },
    netnames: { q: { bits: [4] } }, cells: { state: { type: '$dff', parameters: { CLK_POLARITY: '1' },
      connections: { CLK: [2], D: [4], Q: [4] }, port_directions: { CLK: 'input', D: 'input', Q: 'output' } } } };
}
const source = 'struct p_webrtltop { value<1> p_clk; value<1> p_reset; wire<1> p_q; p_webrtltop(interior) {} };';
test('scheduled compiler rejects unsafe layout and clock changes before emitting executable code', async () => {
  const { generateFastBackend } = await load();
  assert.equal(generateFastBackend(fixture(), source, 'generic').supported, true);
  for (const modify of [
    (m) => { m.cells.state.connections.CLK = [3]; },
    (m) => { m.cells.state.type = '$dlatch'; },
    (m) => { m.netnames = {}; },
    (m) => { m.ports['$escaped'] = { direction: 'input', bits: [5] }; },
  ]) {
    const module = fixture(); modify(module);
    const result = generateFastBackend(module, source, 'generic');
    assert.equal(result.supported, false);
    assert.ok(result.reason.length > 0);
    assert.ok(!result.source.includes('fast_rising'));
  }
});
test('scheduled compiler rejects asynchronous feedback and clock-dependent loads', async () => {
  const { generateFastBackend } = await load();
  for (const input of [[2], [4]]) {
    const module = fixture();
    const c = module.cells.state;
    c.type = '$aldff'; c.connections.ALOAD = input; c.connections.AD = ['0'];
    c.parameters.ALOAD_POLARITY = '1'; c.port_directions.ALOAD = c.port_directions.AD = 'input';
    assert.equal(generateFastBackend(module, source, 'generic').supported, false);
  }
});
