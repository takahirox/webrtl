// Fixed one-cycle bus: valid qualifies a transaction, write selects its direction.
// ROM: 0000-0003; RAM: 0100-0103. No aliases or wait states.
module bus_decoder(
    input clk,
    input reset,
    input valid,
    input write,
    input [15:0] address,
    input [7:0] write_data,
    output [7:0] read_data
);
    wire rom_select = address[15:2] == 14'h0000;
    wire ram_select = address[15:2] == 14'h0040;
    wire [7:0] rom_data, ram_data;
    bus_rom rom(.address(address[1:0]), .read_data(rom_data));
    bus_ram ram(
        .clk(clk), .reset(reset),
        .write_enable(valid && write && ram_select && !reset),
        .address(address[1:0]), .write_data(write_data), .read_data(ram_data)
    );
    // Inactive transactions, writes, reset and unmapped reads return zero.
    assign read_data = reset || !valid || write ? 8'h00 :
                       rom_select ? rom_data : ram_select ? ram_data : 8'h00;
endmodule
