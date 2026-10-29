// Four writable bytes. Reset clears all bytes, and overrides writes.
// Combinational read; writes commit on the rising clock edge.
module bus_ram(
    input clk,
    input reset,
    input write_enable,
    input [1:0] address,
    input [7:0] write_data,
    output [7:0] read_data
);
    reg [7:0] memory [0:3];
    integer i;
    always @(posedge clk) begin
        if (reset) begin
            for (i = 0; i < 4; i = i + 1)
                memory[i] <= 8'h00;
        end else if (write_enable) begin
            memory[address] <= write_data;
        end
    end
    assign read_data = memory[address];
endmodule
