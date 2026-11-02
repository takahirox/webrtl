// The Counter output contract carries the master's result/last transaction byte.
// See docs/cpu-bus.md for bus timing, the cycle trace, and pass/fail codes.
module bus_test(
    input clk,
    input reset,
    output [7:0] count
);
    wire valid, write;
    wire [15:0] address;
    wire [7:0] write_data, read_data;

    bus_master master(
        .clk(clk), .reset(reset), .valid(valid), .write(write),
        .address(address), .write_data(write_data), .read_data(read_data),
        .result(count)
    );
    bus_decoder memory_bus(
        .clk(clk), .reset(reset), .valid(valid), .write(write),
        .address(address), .write_data(write_data), .read_data(read_data)
    );
endmodule
