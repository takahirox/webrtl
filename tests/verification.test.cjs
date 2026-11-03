const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const load = (path) => import(`data:text/javascript;base64,${Buffer.from(readFileSync(path)).toString("base64")}`);
const project = load("web/project.js"), verification = load("web/verification.js");
const io = [{ name: "a", direction: "in", width: 8, lsb: 0 }, { name: "sum", direction: "out", width: 9, lsb: 0 }];

test("source paths reject traversal, injection and unsupported files before virtual filesystem access", async () => {
  const { validateFilename, virtualFiles, validateProject } = await project;
  for (const name of ["../escape.v", "/tmp/a.v", "a//b.sv", "a/../b.py", "-flag.v", "bad name.v", "a;quit.v", "a`cmd`.v", "a\\b.v", "README.md"])
    assert.throws(() => validateFilename(name), /Invalid source name/);
  const files = { "rtl/dut.sv": "module dut; endmodule", "ref/model.py": "print('hello')", "__proto__/ref.cpp": "int main() {}" };
  validateProject({ files, top: "dut" });
  const tree = virtualFiles(files);
  assert.equal(Object.getPrototypeOf(tree), null);
  assert.equal(tree.rtl["dut.sv"], files["rtl/dut.sv"]);
  assert.equal(tree.__proto__["ref.cpp"], "int main() {}");
});

test("scoreboard rejects invalid CSV instead of truncating or silently ignoring expectations", async () => {
  const { parseVectors } = await verification;
  const [sample] = parseVectors("a,sum\n255,0x100\n", io);
  assert.deepEqual(Object.entries(sample.inputs), [["a", "0xff"]]);
  assert.deepEqual(Object.entries(sample.expected), [["sum", "0x100"]]);
  for (const csv of ["a,sum", "a,a\n1,1", "a,sum\n256,1", "a,sum\n1,-1", "a,sum\n1,1,1", "a\n1", "sum\n1", "a,missing\n1,1", `a,sum\n${"1,1\n".repeat(257)}`])
    assert.throws(() => parseVectors(csv, io));
});

test("verification rejects event simulation constructs, including parenthesized delays", async () => {
  const { validateClockedHarness } = await project;
  for (const code of ["initial #5 a=1;", "always #(5) clk=~clk;", "assign #(5) a=b;", "class Driver; endclass", "$finish;", "assert property (a);", "`include \"tasks.sv\""])
    assert.throws(() => validateClockedHarness({ "tb.sv": code }), /clocked SV/);
  validateClockedHarness({ "rtl.sv": 'module dut #(parameter N=8)(); cell #(.N(N)) c(); localparam W=$clog2(N); endmodule // initial #5 $finish' });
});

test("verification rejects primitive delays and specify timing without rejecting module parameters", async () => {
  const { validateClockedHarness } = await project;
  for (const primitive of ["and", "nand", "or", "nor", "xor", "xnor", "buf", "not", "bufif0", "bufif1", "notif0", "notif1", "nmos", "pmos", "cmos", "rnmos", "rpmos", "rcmos", "tran", "rtran", "tranif0", "tranif1", "rtranif0", "rtranif1", "pullup", "pulldown"]) {
    for (const delay of ["#(5)", "#(1, 2, 3)", "/* timing */ # /* delay */ (5)"])
      assert.throws(() => validateClockedHarness({ "dut.v": `module dut(input a, output y); ${primitive} ${delay} delayed_gate(y,a); endmodule` }), /clocked SV/);
  }
  assert.throws(() => validateClockedHarness({ "dut.v": "module dut(input a, output y); assign y=a; specify (a => y)=5; endspecify endmodule" }), /clocked SV/);
  validateClockedHarness({ "dut.v": 'module dut #(parameter N=8)(); cell #(N) c(); cell #(.N(N)) d(); buf b(y,a); endmodule /* specify (a => y)=5; endspecify */ // buf #(5) b(y,a);' });
});

test("verification rejects net declaration delays while preserving module parameters after nets", async () => {
  const { validateClockedHarness } = await project;
  for (const net of ["wire", "tri", "tri0", "tri1", "wand", "triand", "wor", "trior", "trireg", "uwire", "supply0", "supply1", "interconnect"]) {
    for (const modifiers of ["", "signed", "[7:0]", "(strong1, pull0) vectored signed [7:0]"]) {
      for (const delay of ["#(5)", "#(1, 2, 3)", "/* timing */ # /* delay */ (5)"])
        assert.throws(() => validateClockedHarness({ "dut.v": `module dut(input a, output y); ${net} ${modifiers} ${delay} delayed=a; assign y=delayed; endmodule` }), /clocked SV/);
    }
  }
  validateClockedHarness({ "dut.v": `module cell #(parameter N=8)(input [N-1:0] a, output wire [N-1:0] y);
    wire [N-1:0] value=a; assign y=value; endmodule
    module dut(input a, output wire y); wire b=a;
    cell #(1) c(b,y); cell #(.N(1)) d(b,y); endmodule // wire #(5) delayed=a;` });
});

test("verification distinguishes named procedural blocks from module parameterization", async () => {
  const { validateClockedHarness } = await project;
  for (const statement of ["if (reset) sum <= 0; else sum <= a+b;", "update_sum();"]) {
    for (const label of ["delayed", "dut", "delayed$block", "\\delayed", "\\foo.bar"]) {
      for (const delay of ["#(5)", "/* timing */ # /* delay */ ((2 + 3))"]) {
        assert.throws(() => validateClockedHarness({ "dut.sv": `module dut(input clk, reset, a, b, output reg sum);
          always @(posedge clk) begin : ${label} ${delay} ${statement} end endmodule` }), /clocked SV/);
      }
    }
  }
  validateClockedHarness({ "dut.sv": `module automatic dut #(parameter N=(2 + 3))();
    cell #(.N($clog2(N))) c();
    if (N > 1) begin : generated
      cell #(N) instances [0:1] ();
    end
    endmodule` });
  validateClockedHarness({ "dut.sv": `module helper #(parameter N=8)(); endmodule
    module \\dut.helper #(parameter N=8)();
      helper #(N) \\instance.name ();
    endmodule` });
});

test("CSV preserves prototype-like input and output names and compares their expectations", async () => {
  const { parseVectors, compareVectors } = await verification;
  for (const name of ["__proto__", "constructor", "toString"]) {
    for (const direction of ["in", "out"]) {
      const input = direction === "in" ? name : "a", output = direction === "out" ? name : "sum";
      const ports = [{ name: input, direction: "in", width: 8, lsb: 0 }, { name: output, direction: "out", width: 8, lsb: 0 }];
      const vectors = parseVectors(`${input},${output}\n2,99`, ports);
      assert.deepEqual(Object.entries(vectors[0].inputs), [[input, "0x2"]]);
      assert.deepEqual(Object.entries(vectors[0].expected), [[output, "0x63"]]);
      let actual;
      const simulator = {
        _sim_inputs(inputs) { actual = BigInt(inputs[input]) + 1n; },
        _sim_step() { return { cycles: 1, io: [{ name: output, hex: actual.toString(16) }] }; },
      };
      const [sample] = await compareVectors(simulator, vectors, new AbortController().signal, () => {});
      assert.deepEqual(sample.mismatches, [{ name: output, expected: "0x63", actual: "0x3" }]);
    }
  }
});

test("VCD preserves actual sampled widths and cycles, independently of expected values", async () => {
  const { toVCD } = await verification;
  const vcd = toVCD([{ cycle: 7, values: [{ name: "sum", width: 9, hex: "105" }], expected: { sum: "0" } }]);
  assert.match(vcd, /\$var wire 9 s0 \\sum \$end/);
  assert.match(vcd, /#7\nb100000101 s0/);
});

test("Python memory cap bounds internal Wasm memory growth, including variable-length declarations", async () => {
  const { limitWasmMemory } = await load("web/wasm-memory.js");
  const wasm = new Uint8Array([0,97,115,109,1,0,0,0, 5,6,1,1,1,128,128,2,
    7,10,1,6,109,101,109,111,114,121,2,0]);
  const { instance } = await WebAssembly.instantiate(limitWasmMemory(wasm, 2));
  assert.equal(instance.exports.memory.grow(1), 1);
  assert.throws(() => instance.exports.memory.grow(1), RangeError);
  assert.throws(() => limitWasmMemory(wasm, 0));
  assert.throws(() => limitWasmMemory(wasm.slice(0, 14), 2));
});
