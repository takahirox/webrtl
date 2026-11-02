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
  assert.deepEqual(parseVectors("a,sum\n255,0x100\n", io), [{ inputs: { a: "0xff" }, expected: { sum: "0x100" } }]);
  for (const csv of ["a,sum", "a,a\n1,1", "a,sum\n256,1", "a,sum\n1,-1", "a,sum\n1,1,1", "a\n1", "sum\n1", "a,missing\n1,1", `a,sum\n${"1,1\n".repeat(257)}`])
    assert.throws(() => parseVectors(csv, io));
});

test("verification rejects event simulation constructs, including parenthesized delays", async () => {
  const { validateClockedHarness } = await project;
  for (const code of ["initial #5 a=1;", "always #(5) clk=~clk;", "assign #(5) a=b;", "class Driver; endclass", "$finish;", "assert property (a);", "`include \"tasks.sv\""])
    assert.throws(() => validateClockedHarness({ "tb.sv": code }), /clocked SV/);
  validateClockedHarness({ "rtl.sv": 'module dut #(parameter N=8)(); cell #(.N(N)) c(); localparam W=$clog2(N); endmodule // initial #5 $finish' });
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
