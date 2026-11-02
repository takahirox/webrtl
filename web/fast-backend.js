// Compile RTLIL dependencies into a straight-line, edge-specialized Wasm kernel.
// CXXRTL supplies bit-vector primitives and canonical storage, not evaluation.
const unary = new Set(['not', 'pos', 'neg']);
const binary = new Set(['and', 'or', 'xor', 'xnor', 'add', 'sub', 'mul', 'div', 'mod',
  'divfloor', 'modfloor', 'eq', 'ne', 'eqx', 'nex', 'lt', 'le', 'gt', 'ge']);
const shifts = new Set(['shl', 'shr', 'sshl', 'sshr', 'shift', 'shiftx']);
const logical = new Set(['logic_not', 'logic_and', 'logic_or', 'reduce_and', 'reduce_or',
  'reduce_xor', 'reduce_xnor', 'reduce_bool']);
const number = (value) => parseInt(value || '0', 2);
const same = (a, b) => a.length === b.length && a.every((bit, i) => bit === b[i]);
// Pinned write_cxxrtl identifier encoding. Verify every binding against its
// generated declaration; a changed layout must fall back, never guess storage.
function identifier(name) {
  const prefix = name.startsWith('$') ? 'i_' : 'p_';
  return prefix + [...(name.startsWith('$') ? name.slice(1) : name)].map((c) =>
    /[a-zA-Z0-9]/.test(c) ? c : c === '_' ? '__' : `_${c.charCodeAt(0).toString(16)}_`).join('');
}
function constant(bits) {
  const words = [];
  for (let i = 0; i < bits.length; i += 32)
    words.push(`0x${parseInt(bits.slice(i, i + 32).map((b) => b === '1' ? '1' : '0').reverse().join(''), 2).toString(16)}u`);
  return `value<${bits.length}>{${words.join(',')}}`;
}

export function generateFastBackend(module, source, board) {
  try { return generate(module, source, board); }
  catch (error) {
    if (!(error instanceof Unsupported)) throw error;
    return { supported: false, reason: error.message,
      source: 'static constexpr bool fast_available = false;\nstatic void fast_tick() {}\n' };
  }
}
class Unsupported extends Error {}
function require(condition, message) { if (!condition) throw new Unsupported(message); }
function generate(module, source, board) {
  const cells = Object.values(module.cells);
  const declarations = new Map([...source.slice(0, source.indexOf('p_webrtltop(interior)'))
    .matchAll(/(?:\/\*outline\*\/ )?\b(wire|value)<(\d+)> (\w+);/g)]
    .filter((m) => !m[0].includes('outline'))
    .map((m) => [m[3], { kind: m[1], width: +m[2] }]));
  const stateBits = new Map();
  for (const kind of ['wire', 'value']) for (const [name, net] of Object.entries(module.netnames)) {
    const field = identifier(name), declaration = declarations.get(field);
    if (declaration?.kind !== kind || declaration.width !== net.bits.length) continue;
    net.bits.forEach((bit, offset) => {
      if (typeof bit === 'number' && !stateBits.has(bit)) stateBits.set(bit,
        { field: `model.${field}`, kind, offset, width: net.bits.length });
    });
  }
  const storage = (bits) => bits.map((bit) => {
    const binding = stateBits.get(bit);
    require(binding, 'Register storage layout is not compatible with the scheduled backend.');
    return binding;
  });
  const clock = module.ports.clk.bits;
  const registers = [], memories = [], drivers = new Map(), roots = new Map();
  const bind = (map, bits, expression) => bits.forEach((bit, offset) => {
    require(typeof bit === 'number' && !map.has(bit), 'Aliased or multiple-driven state is unsupported.');
    map.set(bit, { expression, offset, width: bits.length });
  });
  for (const [name, port] of Object.entries(module.ports)) {
    if (port.direction === 'input') {
      const field = identifier(name), declaration = declarations.get(field);
      require(declaration?.width === port.bits.length, 'Input storage layout is not compatible.');
      bind(roots, port.bits, name === 'clk' ? 'value<1>{level ? 1u : 0u}' :
        `model.${field}${declaration.kind === 'wire' ? '.curr' : ''}`);
    }
  }
  for (const cell of cells) {
    const { type, parameters: p, connections: c } = cell;
    if (type === '$scopeinfo') continue;
    if (['$dff', '$adff', '$aldff'].includes(type)) {
      require(same(c.CLK, clock), 'Generated or independent clocks require CXXRTL.');
      const bindings = storage(c.Q);
      registers.push({ cell, bindings, rising: number(p.CLK_POLARITY) === 1 });
      c.Q.forEach((bit, i) => {
        require(!roots.has(bit), 'Aliased sequential outputs require CXXRTL.');
        const binding = bindings[i];
        roots.set(bit, { expression: binding.field + (binding.kind === 'wire' ? '.curr' : ''),
          offset: binding.offset, width: binding.width });
      });
    } else if (type === '$mem_v2') {
      require(number(p.RD_CLK_ENABLE) === 0 && number(p.RD_TRANSPARENCY_MASK) === 0 &&
        number(p.RD_COLLISION_X_MASK) === 0 && number(p.RD_WIDE_CONTINUATION) === 0 &&
        number(p.WR_WIDE_CONTINUATION) === 0 && number(p.ABITS) <= 32 && number(p.OFFSET) === 0,
      'Clocked/transparent/wide memory ports or nonzero memory offsets require CXXRTL.');
      const width = number(p.WIDTH), depth = number(p.SIZE), abits = number(p.ABITS);
      const writes = number(p.WR_PORTS), reads = number(p.RD_PORTS);
      const field = `model.memory_${identifier(p.MEMID.replace(/^\\/, ''))}`;
      require(source.includes(`memory<${width}> ${field.slice(6)} { ${depth}u }`), 'Memory storage layout is not compatible.');
      for (let i = 0; i < writes; ++i) {
        require(p.WR_CLK_ENABLE.at(-1 - i) === '1' && same(c.WR_CLK.slice(i, i + 1), clock),
          'Asynchronous memory writes or generated memory clocks require CXXRTL.');
        // Match pinned CXXRTL's deterministic write queue order (port index).
        // RTL with conflicting unordered writes has the same two-state choice.
      }
      for (let i = 0; i < reads; ++i) require(c.RD_EN[i] === '1' && c.RD_ARST[i] === '0' && c.RD_SRST[i] === '0',
        'Enabled or resettable memory reads require CXXRTL.');
      memories.push({ cell, field, width, depth, abits, writes, reads });
      c.RD_DATA.forEach((bit, offset) => drivers.set(bit, { cell, port: Math.floor(offset / width), offset: offset % width, width }));
    } else {
      const op = type.slice(1);
      require(type.startsWith('$') && (unary.has(op) || binary.has(op) || shifts.has(op) || logical.has(op) || ['mux', 'pmux', 'bmux', 'demux', 'bwmux'].includes(op)),
        `Cell ${type} requires CXXRTL.`);
      require(c.Y?.length > 0, `Cell ${type} has no supported output.`);
      c.Y.forEach((bit, offset) => {
        require(typeof bit === 'number' && !drivers.has(bit), 'Multiple-driven combinational nets require CXXRTL.');
        drivers.set(bit, { cell, offset, width: c.Y.length });
      });
    }
  }
  require(registers.length > 0 || memories.length > 0, 'No schedulable sequential state.');
  for (const bit of roots.keys()) require(!drivers.has(bit), 'State/combinational driver overlap requires CXXRTL.');
  // Validate the complete dependency graph, even cones not needed by the board.
  // Reject combinational cycles before emitting any executable fast code.
  function schedule(level, targets) {
    const lines = [], cache = new Map(), active = new Set();
    const signal = (bits) => {
      require(bits?.length > 0, 'Empty signal requires CXXRTL.');
      const groups = [];
      for (let i = 0; i < bits.length;) {
        if (typeof bits[i] !== 'number') {
          let end = i + 1;
          while (end < bits.length && typeof bits[end] !== 'number') end++;
          groups.push(constant(bits.slice(i, end))); i = end; continue;
        }
        const part = resolve(bits[i]);
        let end = i + 1;
        while (end < bits.length && typeof bits[end] === 'number') {
          const next = roots.get(bits[end]) || drivers.get(bits[end]);
          const first = roots.get(bits[i]) || drivers.get(bits[i]);
          if (!next || next.cell !== first.cell || next.port !== first.port ||
              next.expression !== first.expression || next.offset !== part.offset + end - i) break;
          end++;
        }
        const size = end - i;
        groups.push(size === part.width && part.offset === 0 ? part.expression :
          `(${part.expression}).slice<${part.offset + size - 1},${part.offset}>().val()`);
        i = end;
      }
      return groups.reverse().reduce((a, b) => a ? `(${a}).concat(${b}).val()` : b, '');
    };
    function resolve(bit) {
      if (roots.has(bit)) return roots.get(bit);
      const driver = drivers.get(bit);
      require(driver, 'Undriven nets require CXXRTL.');
      const { cell, port = 0 } = driver;
      let ports = cache.get(cell);
      if (!ports) { ports = new Map(); cache.set(cell, ports); }
      if (!ports.has(port)) {
        require(!active.has(cell), 'Combinational feedback requires iterative CXXRTL settling.');
        active.add(cell);
        const { connections: c, parameters: p } = cell;
        const op = cell.type.slice(1), width = driver.width;
        const input = (name) => signal(c[name]);
        let expression;
        if (op === 'mem_v2') {
          const mem = memories.find((m) => m.cell === cell);
          const address = signal(c.RD_ADDR.slice(port * mem.abits, (port + 1) * mem.abits));
          const index = `a${lines.length}`;
          lines.push(`const auto ${index} = memory_index(${address}, 0, ${mem.depth});`,
            `if (!${index}.valid) __builtin_trap();`);
          expression = `${mem.field}.data[${index}.index]`;
        } else if (op === 'bmux' || op === 'demux') {
          const stride = op === 'bmux' ? width : c.A.length;
          const shiftWidth = c.S.length + Math.ceil(Math.log2(stride)) + 1;
          expression = `${op === 'bmux' ? 'shiftx' : 'shl'}_uu<${width}>(${input('A')}, mul_uu<${shiftWidth}>(${input('S')}, value<32>{${stride}u}))`;
        } else if (op === 'bwmux') expression = `(${input('A')}).bit_and((${input('S')}).bit_not()).bit_or((${input('B')}).bit_and(${input('S')}))`;
        else if (op === 'mux') expression = `(bool(${input('S')}) ? ${input('B')} : ${input('A')})`;
        else if (op === 'pmux') {
          // Yosys parallel mux: OR selected slices, use A only if no select.
          const terms = c.S.map((bit, i) => `(bool(${signal([bit])}) ? ${signal(c.B.slice(i * width, (i + 1) * width))} : value<${width}>{})`);
          expression = `(bool(${input('S')}) ? ${terms.reduce((a, b) => a ? `(${a}).bit_or(${b})` : b, '')} : ${input('A')})`;
        } else {
          const a = number(p.A_SIGNED) ? 's' : 'u', b = number(p.B_SIGNED) ? 's' : 'u';
          const suffix = logical.has(op) ? '' : unary.has(op) ? `_${a}` : shifts.has(op) ?
            `_${a}${['shift', 'shiftx'].includes(op) ? b : 'u'}` : `_${a === 's' && b === 's' ? 'ss' : 'uu'}`;
          expression = `${op}${suffix}<${width}>(${input('A')}${c.B ? `, ${input('B')}` : ''})`;
        }
        const name = `v${lines.length}`;
        lines.push(`const auto ${name} = ${expression};`);
        ports.set(port, name); active.delete(cell);
      }
      return { ...driver, expression: ports.get(port) };
    }
    const result = targets(signal, lines);
    return { text: lines.join('\n'), result };
  }
  // This validation emits no runtime work. It also rejects unsupported async
  // controls even when a particular board does not observe them.
  schedule(true, (signal) => { for (const cell of cells) for (const [port, direction] of Object.entries(cell.port_directions))
    if (direction === 'output' && cell.type !== '$scopeinfo') signal(cell.connections[port]); });
  // In-place asynchronous stores are safe only for independent loads. Even an
  // acyclic dependency can hide an intermediate reset pulse seen by CXXRTL's
  // evaluation/commit rounds. Keep those circuits on the reference evaluator.
  const asyncRegs = registers.filter((r) => r.cell.type !== '$dff');
  const owner = new Map(asyncRegs.flatMap((r) => r.cell.connections.Q.map((b) => [b, r])));
  for (const reg of asyncRegs) {
    const seen = new Set();
    function dependencies(bits) {
      for (const bit of bits) {
        if (typeof bit !== 'number' || seen.has(bit)) continue;
        seen.add(bit);
        require(!clock.includes(bit), 'Clock-sensitive asynchronous loads require CXXRTL.');
        require(!owner.has(bit), 'Interdependent asynchronous loads require CXXRTL to preserve intermediate pulses.');
        if (!roots.has(bit)) {
          const driver = drivers.get(bit);
          require(driver && driver.cell.type !== '$mem_v2', 'Memory-dependent asynchronous loads require CXXRTL.');
          for (const [port, direction] of Object.entries(driver.cell.port_directions))
            if (direction === 'input') dependencies(driver.cell.connections[port]);
        }
      }
    }
    const c = reg.cell.connections;
    dependencies(c.ARST || c.ALOAD);
    if (c.AD) dependencies(c.AD);
  }
  const asyncCode = asyncRegs.map((reg) => {
    const { connections: c, parameters: p } = reg.cell;
    const load = c.ARST ? 'ARST' : 'ALOAD';
    const scheduled = schedule(false, (signal, lines) => {
      const test = signal(c[load]);
      const value = c.ARST ? constant([...p.ARST_VALUE].reverse()) : signal(c.AD);
      lines.push(`if (bool(${test}) == ${number(p[`${load}_POLARITY`]) ? 'true' : 'false'}) { ${store(reg, value)} }`);
    });
    return `{ ${scheduled.text} }`;
  }).join('\n');
  const outputs = Object.entries(module.ports).filter(([name, port]) => port.direction === 'output' &&
    ((board === 'video' || board === 'snes') && name.startsWith('video_') ||
     (board === 'audio' || board === 'snes') && name.startsWith('audio_')));
  function store(reg, value) {
    const assignments = [];
    for (let i = 0; i < reg.bindings.length;) {
      const binding = reg.bindings[i];
      let end = i + 1;
      while (end < reg.bindings.length && reg.bindings[end].field === binding.field &&
        reg.bindings[end].offset === binding.offset + end - i) end++;
      const count = end - i;
      const rhs = count === reg.bindings.length ? value : `(${value}).slice<${end - 1},${i}>().val()`;
      const lhs = (suffix) => `${binding.field}${suffix}${count === binding.width ? '' : `.slice<${binding.offset + count - 1},${binding.offset}>()`}`;
      assignments.push(binding.kind === 'wire' ? `${lhs('.curr')} = ${rhs}; ${lhs('.next')} = ${rhs};` : `${lhs('')} = ${rhs};`);
      i = end;
    }
    return assignments.join('\n');
  }
  const edge = (rising) => schedule(rising, (signal, lines) => {
    const stores = [];
    for (const reg of registers.filter((r) => r.rising === rising)) {
      const name = `n${lines.length}`;
      const c = reg.cell.connections, p = reg.cell.parameters;
      let value = signal(c.D);
      if (reg.cell.type === '$adff' || reg.cell.type === '$aldff') {
        const load = reg.cell.type === '$adff' ? 'ARST' : 'ALOAD';
        const reset = reg.cell.type === '$adff' ? constant([...p.ARST_VALUE].reverse()) : signal(c.AD);
        value = `(bool(${signal(c[load])}) == ${number(p[`${load}_POLARITY`]) ? 'true' : 'false'} ? ${reset} : ${value})`;
      }
      lines.push(`const auto ${name} = ${value};`);
      stores.push(store(reg, name));
    }
    for (const mem of memories) for (let port = 0; port < mem.writes; ++port) {
      if ((mem.cell.parameters.WR_CLK_POLARITY.at(-1 - port) === '1') !== rising) continue;
      const c = mem.cell.connections, id = `w${lines.length}`;
      const en = signal(c.WR_EN.slice(port * mem.width, (port + 1) * mem.width));
      const addr = signal(c.WR_ADDR.slice(port * mem.abits, (port + 1) * mem.abits));
      const data = signal(c.WR_DATA.slice(port * mem.width, (port + 1) * mem.width));
      lines.push(`const auto ${id}e = ${en};`, `const auto ${id}a = memory_index(${addr}, 0, ${mem.depth});`,
        `const auto ${id}d = ${data};`);
      stores.push(`if (${id}e) { if (!${id}a.valid) __builtin_trap(); auto &word = ${mem.field}.data[${id}a.index]; word = word.update(${id}d, ${id}e); }`);
    }
    return stores.join('\n');
  });
  const rising = edge(true), falling = edge(false);
  const media = schedule(true, (signal, lines) => {
    for (const [name, port] of outputs) {
      const field = identifier(name), d = declarations.get(field);
      require(d?.width === port.bits.length, 'Output storage layout is not compatible.');
      const value = signal(port.bits);
      lines.push(d.kind === 'wire' ? `model.${field}.curr = model.${field}.next = ${value};` : `model.${field} = ${value};`);
    }
  });
  return { supported: true, reason: '', registers: registers.length, memories: memories.length,
    source: `static constexpr bool fast_available = true;
static void fast_rising() { const bool level = true; ${rising.text}\n${rising.result} }
static void fast_falling() { const bool level = false; ${falling.text}\n${falling.result} }
static void fast_media() { const bool level = true; ${media.text} }
static void fast_async() { ${asyncCode} }
static void fast_tick() { fast_rising(); fast_async(); fast_media(); ++cycle_count; capture_outputs(); fast_falling(); fast_async(); }
` };
}
