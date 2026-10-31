module debug_store(input clk, input reset, input write_enable,
    input [3:0] address, input [7:0] write_data, output [7:0] read_data);
    reg [7:0] memory [0:15];
    integer i;
    always @(posedge clk) begin
        if (reset) for (i = 0; i < 16; i = i + 1) memory[i] <= 0;
        else if (write_enable) memory[address] <= write_data;
    end
    assign read_data = memory[address];
endmodule
