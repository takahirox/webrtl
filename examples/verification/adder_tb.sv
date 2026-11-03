// Synthesizable, synchronous SystemVerilog testbench. No delays, initial
// processes or event-driven system tasks. Can also run under standard HDL tools.
module adder_tb(input logic clk, reset, output logic failed,
                output logic [4:0] position, output logic [8:0] actual, expected);
  logic [7:0] a, b;
  logic [8:0] next_expected;
  assign a = {3'b0, position} * 8'd17;
  assign b = 8'd255 - {3'b0, position} * 8'd11;
  assign next_expected = {1'b0, a} + {1'b0, b};
  adder dut(.clk(clk), .reset(reset), .a(a), .b(b), .sum(actual));
  always_ff @(posedge clk) begin
    if (reset) begin
      position <= 0;
      expected <= 0;
    end else begin
      position <= position + 1;
      expected <= next_expected;
    end
  end
  assign failed = actual != expected;
endmodule
