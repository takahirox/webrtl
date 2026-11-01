// Generic two-file fixture: rising/falling-edge state and writable RAM.
module debug_ram(input clk, input reset, input enable, input [7:0] stimulus,
                 output reg [15:0] sum, output reg [15:0] shadow);
    reg [3:0] address;
    reg [64:0] wide_state;
    wire [7:0] read_data;
    debug_store storage(.clk(clk), .reset(reset), .write_enable(enable),
        .address(address), .write_data(stimulus ^ {4'b0, address} ^ sum[7:0]), .read_data(read_data));
    always @(posedge clk) begin
        if (reset) begin address <= 0; sum <= 0; wide_state <= 65'h10000000000000001; end
        else if (enable) begin
            address <= address + 1;
            sum <= sum + read_data + stimulus;
            wide_state <= {wide_state[63:0], wide_state[64] ^ wide_state[3]};
        end
    end
    always @(negedge clk) begin
        if (reset) shadow <= 0;
        else shadow <= sum ^ 16'h1234;
    end
endmodule
