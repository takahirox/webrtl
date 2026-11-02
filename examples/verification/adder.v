// One-cycle registered adder. Reset initializes the observed sum to zero.
module adder(input clk, input reset, input [7:0] a, b, output reg [8:0] sum);
  always @(posedge clk)
    if (reset) sum <= 0;
    else sum <= {1'b0, a} + {1'b0, b};
endmodule
