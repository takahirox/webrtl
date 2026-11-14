const { test, expect } = require("../pr-profile.cjs");

async function openAdder(page) {
  await page.goto(process.env.WEBRTL_PUBLIC_URL || "./");
  await expect(page.locator("#source")).toBeEnabled();
  await page.getByRole("button", { name: "Verification", exact: true }).click();
  await page.locator("#load-verification").click();
  await expect(page.locator("#top")).toHaveValue("adder");
}
async function verify(page, text) {
  await page.locator("#verify").click();
  await expect(page.locator("#verification-status")).toHaveText(/^(PASS|FAIL|Verification error|Cancelled)/, { timeout: 120000 });
  await expect(page.locator("#verification-status")).toContainText(text);
  await expect(page.locator("#cancel-verification")).toBeDisabled();
}

test("C++ and Python references compare real RTL, expose a mismatch and export sampled VCD", async ({ page }, testInfo) => {
  const errors = [], requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openAdder(page);
  await expect(page.locator("#reference-source")).toHaveValue(/import csv/);
  await verify(page, "PASS · 16/16");
  await expect(page.locator("#test-results li")).toHaveCount(16);
  await page.locator("#waveform-panel summary").click();
  await page.locator("#waveform-signal").selectOption("sum");
  await page.locator("#waveform-sample").fill("2");
  await expect(page.locator("#waveform-values")).toContainText("cycle 2");
  await expect(page.locator("#waveform-values")).toContainText("sum = 0x105"); // 17 + 244 = 261
  await expect(page.locator("#waveform text").nth(1)).toHaveText("2: 105");
  const download = page.waitForEvent("download");
  await page.locator("#export-vcd").click();
  const artifact = await download;
  const path = testInfo.outputPath("trace.vcd"); await artifact.saveAs(path);
  const vcd = require("node:fs").readFileSync(path, "utf8");
  expect(vcd).toContain("$enddefinitions $end");
  expect(vcd).toContain("b100000101");
  expect(vcd).toContain("#16");

  await page.locator("#reference-model").selectOption("adder.py");
  await verify(page, "PASS · 16/16");
  // Independently incorrect reference: compare against actual newly sampled RTL.
  await page.locator("#split-file").selectOption("adder.py");
  const python = await page.locator("#reference-source").inputValue();
  await page.locator("#reference-source").fill(python.replace("sum([a, b])", "sum([a, b]) + 1"));
  await page.locator("#files").selectOption("adder.py");
  await expect(page.locator("#source")).toHaveValue(/sum\(\[a, b\]\) \+ 1/);
  await verify(page, "FAIL at sample 1, cycle 1");
  await expect(page.locator("#test-results")).toContainText("sum: expected 0x100, actual 0x0ff");
  await expect(page.locator("#test-results")).toContainText('"a":"0x0","b":"0xff"');
  await page.locator("#debug-mismatch").click();
  await expect(page.locator("#status")).toContainText("Debug Mode · paused at cycle 1");
  await page.locator("#signal-filter").fill("sum");
  const signal = await page.locator("#signals option").first().getAttribute("value");
  await page.locator("#signals").selectOption(signal);
  await page.locator("#inspect").click();
  await expect(page.locator("#signal-values")).toContainText("0x0ff");
  await page.locator("#step").click();
  await expect(page.locator("#timing")).toContainText("2 cycles");
  await expect(page.locator("#debug-mismatch")).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#split-file").selectOption("");
  await expect(page.locator("#reference-editor")).toBeHidden();
  await page.locator("#files").selectOption("adder.v");
  await expect(page.locator("#source")).toHaveValue(/module adder/);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#example").selectOption("single");
  await page.locator("#load-example").click();
  await page.locator("#compile").click();
  await expect(page.locator("#step")).toBeEnabled({ timeout: 120000 });
  await page.locator("#step").click();
  await expect(page.locator("#count")).toHaveText("1");
  expect(errors).toEqual([]);
  expect(requests.every((r) => r.method === "GET" && new URL(r.url).origin === new URL(page.url()).origin)).toBe(true);
});

test("clocked SV harness, invalid reference and cancellation leave usable controls", async ({ page }) => {
  await openAdder(page);
  await page.locator("#verify").click();
  await expect(page.locator("#cancel-verification")).toBeEnabled();
  await page.locator("#cancel-verification").click();
  await expect(page.locator("#verification-status")).toContainText("Cancelled");
  await expect(page.locator("#compile")).toBeEnabled();
  await page.locator("#files").selectOption("adder.v");
  const originalRTL = await page.locator("#source").inputValue();
  await page.locator(".project-settings summary").click();
  for (const frontend of ["verilog", "slang"]) {
    await page.locator("#frontend").selectOption(frontend);
    await page.locator("#source").fill(originalRTL.replace(
      "always @(posedge clk)", "always @(posedge clk) begin : delayed #(5)",
    ).replace("endmodule", "end endmodule"));
    await verify(page, "synthesizable clocked SV harnesses only");
    await expect(page.locator("#test-results li")).toHaveCount(0);
    await expect(page.locator("#export-vcd")).toBeDisabled();
    await expect(page.locator("#waveform-sample")).toBeDisabled();
  }
  await page.locator("#source").fill(originalRTL);
  await page.locator("#files").selectOption("adder.py");
  await page.locator("#source").fill("print('a,y\\n1,1\\n0,0')");
  await page.locator("#reference-model").selectOption("adder.py");
  await page.locator("#files").selectOption("adder.v");
  for (const frontend of ["verilog", "slang"]) {
    await page.locator("#frontend").selectOption(frontend);
    for (const timing of [
      "buf #(5) delayed_buf(y,a);",
      "wire #(5) delayed=a; assign y=delayed;",
      "wire (strong1, pull0) signed [0:0] #(5) delayed=a; assign y=delayed;",
      "assign y=a; specify (a => y)=5; endspecify",
    ]) {
      await page.locator("#source").fill(`module adder(input clk, reset, a, output y); ${timing} endmodule`);
      await verify(page, "synthesizable clocked SV harnesses only");
      await expect(page.locator("#test-results li")).toHaveCount(0);
      await expect(page.locator("#export-vcd")).toBeDisabled();
    }
  }
  await page.locator("#frontend").selectOption("verilog");
  await page.locator(".project-settings summary").click();
  await page.locator("#source").fill(originalRTL);
  await page.locator("#top").fill("adder_tb");
  await page.locator("#reference-model").selectOption(":sv");
  await verify(page, "PASS · 16/16");
  // Make DUT wrong, while preserving independently computed harness expectations.
  await page.locator("#files").selectOption("adder.v");
  const rtl = await page.locator("#source").inputValue();
  await page.locator("#source").fill(rtl.replace("{1'b0, b}", "{1'b0, b} + 1"));
  await verify(page, "FAIL at sample 1");
  await expect(page.locator("#test-results")).toContainText("failed: expected 0x0, actual 0x1");
  await page.locator("#files").selectOption("adder_tb.sv");
  const sv = await page.locator("#source").inputValue();
  await page.locator("#source").fill(sv + "\ninitial #5 $finish;\n");
  await verify(page, "synthesizable clocked SV harnesses only");
  await expect(page.locator("#compile")).toBeEnabled();

  await page.locator("#top").fill("adder");
  await page.locator("#source").fill(sv);
  await page.locator("#files").selectOption("adder.py");
  await page.locator("#reference-model").selectOption("adder.py");
  await page.locator("#source").fill("print('not_a_port')\nprint('1')");
  await verify(page, "Unknown, split or unsupported CSV port");
  await page.locator("#source").fill("while True: pass");
  await page.locator("#verify").click();
  await expect(page.locator("#verification-status")).toContainText("Running Python reference", { timeout: 120000 });
  await page.locator("#cancel-verification").click();
  await expect(page.locator("#verification-status")).toContainText("Cancelled");
  await expect(page.locator("#source")).toBeEnabled();
  await expect(page.locator("#step")).toBeEnabled();
  await page.locator("#source").fill("print('a,b,sum')\nprint('1,2,4')");
  await verify(page, "PASS · 1/1"); // intentionally mutated DUT adds one
  await page.locator("#source").fill("raise RuntimeError('reference bug')");
  await verify(page, "reference bug");
  await expect(page.locator("#verify")).toBeEnabled();

  // Legal HDL names must survive CSV parsing and transport to the live RTL.
  for (const direction of ["out", "in"]) {
    const input = direction === "in" ? "__proto__" : "a";
    const output = direction === "out" ? "__proto__" : "sum";
    await page.locator("#files").selectOption("adder.v");
    await page.locator("#source").fill(`module adder(input clk, reset, input [7:0] ${input}, b, output reg [7:0] ${output});
      always @(posedge clk) if (reset) ${output} <= 0; else ${output} <= ${input} + b;
      endmodule`);
    await page.locator("#files").selectOption("adder.py");
    await page.locator("#source").fill(`print('${input},b,${output}')\nprint('1,2,99')`);
    await verify(page, "FAIL at sample 1, cycle 1");
    await expect(page.locator("#test-results")).toContainText(`${output}: expected 0x63, actual 0x03`);
    await expect(page.locator("#test-results")).toContainText(`"${input}":"0x1"`);
    await page.locator("#source").fill(`print('${input},b,${output}')\nprint('1,2,3')`);
    await verify(page, "PASS · 1/1");
  }
});

test("mixed-language project paths preserve edits and enforce reference execution bounds", async ({ page }, testInfo) => {
  await openAdder(page);
  await page.locator("#files").selectOption("adder.v");
  const original = await page.locator("#source").inputValue();
  await page.locator("#source").fill(original + "\n// retained edit");
  await page.locator("#file-actions summary").click();
  await page.locator("#rename-file").click();
  await page.locator("#filename").fill("rtl/adder.sv");
  await page.locator("#filename").press("Enter");
  await expect(page.locator("#project-tree")).toContainText("rtl");
  await expect(page.locator("#project-tree")).toContainText("adder.sv");
  await page.locator("#files").selectOption("adder.cpp");
  await page.locator("#source").fill("not valid C++!");
  await page.locator("#files").selectOption("rtl/adder.sv");
  await expect(page.locator("#source")).toHaveValue(original + "\n// retained edit");
  // Mixed-language files never reach HDL parsing, including nested .sv paths.
  await page.locator("#compile").click();
  await expect(page.locator("#step")).toBeEnabled({ timeout: 120000 });
  await page.locator("#add-file").click();
  await page.locator("#filename").fill("../escape.py");
  await page.locator("#filename").press("Enter");
  await expect(page.locator("#file-error")).toContainText("Invalid source name");
  await page.locator("#filename").fill("ref/check.py");
  await page.locator("#filename").press("Enter");
  await page.locator("#source").fill("print('a,b,sum')\nprint('1,2,3')");
  await page.locator("#reference-model").selectOption("ref/check.py");
  await verify(page, "PASS · 1/1");
  await page.locator("#reference-model").selectOption("adder.cpp");
  await verify(page, "Verification error:");
  await expect(page.locator("#verification-status")).toContainText(/error:/);
  await page.locator("#reference-model").selectOption("ref/check.py");
  await page.locator("#source").fill("while True: pass");
  await verify(page, "exceeded 5 seconds");
  await expect(page.locator("#source")).toBeEnabled();
  await page.locator("#source").fill("print('x' * (1024 * 1024 + 1))");
  await verify(page, "Reference output exceeds 1 MiB");
  await page.locator("#source").fill("buffer = bytearray(600 * 1024 * 1024)");
  await verify(page, /MemoryError|out of memory/);
  await page.locator("#source").fill("print('a,b,sum')\nprint('1,2,3')");
  await verify(page, "PASS · 1/1");
  await page.locator("#waveform-panel summary").click();
  await page.screenshot({ path: testInfo.outputPath("verification-wide.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("verification-narrow.png"), fullPage: true });
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator("#remove-file").click();
  await expect(page.locator("#source")).toHaveValue(/print\('a,b,sum'\)/);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#remove-file").click();
  await expect(page.locator("#reference-model option[value='ref/check.py']")).toHaveCount(0);
  await page.locator("#folder-files").setInputFiles("examples/verification");
  await expect(page.locator("#files option")).toHaveCount(8);
  await page.locator("#files").selectOption("verification/adder.py");
  await expect(page.locator("#source")).toHaveValue(/import csv/);
  await page.locator("#folder-files").setInputFiles("examples/verification");
  await expect(page.locator("#errors")).toContainText("already exists");
  await expect(page.locator("#files option")).toHaveCount(8);

  // Renaming at capacity preserves edits; only operations that add files are blocked.
  await page.locator("#import-files").setInputFiles(Array.from({ length: 120 }, (_, i) => ({
    name: `reference-${i}.py`, mimeType: "text/plain", buffer: Buffer.from(`# reference ${i}`),
  })));
  await expect(page.locator("#files option")).toHaveCount(128);
  const edited = "# retained edit at capacity";
  await page.locator("#source").fill(edited);
  await page.locator("#rename-file").click();
  await page.locator("#filename").fill("ref/renamed.py");
  await page.locator("#filename").press("Enter");
  await expect(page.locator("#file-dialog")).toBeHidden();
  await expect(page.locator("#files")).toHaveValue("ref/renamed.py");
  await expect(page.locator("#files option[value='reference-0.py']")).toHaveCount(0);
  await expect(page.locator("#files option")).toHaveCount(128);
  await expect(page.locator("#source")).toHaveValue(edited);
  await page.locator("#add-file").click();
  await page.locator("#filename").fill("overflow.py");
  await page.locator("#filename").press("Enter");
  await expect(page.locator("#file-error")).toHaveText("Projects support at most 128 source files.");
  await page.locator("#cancel-file").click();
  await page.locator("#import-files").setInputFiles({
    name: "overflow.py", mimeType: "text/plain", buffer: Buffer.from("# overflow"),
  });
  await expect(page.locator("#errors")).toHaveText("Projects support at most 128 source files.");
  await expect(page.locator("#files option")).toHaveCount(128);
  await expect(page.locator("#files")).toHaveValue("ref/renamed.py");
  await expect(page.locator("#source")).toHaveValue(edited);
});
