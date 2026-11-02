// SPDX-License-Identifier: GPL-3.0-or-later
module cpu816_memory (
    input clk, input reset, input valid, input write,
    input [23:0] address, input [7:0] write_data,
    output [7:0] read_data
);
    reg [7:0] ram [0:15];
    wire [7:0] rom_data;
    wire ram_selected = address >= 24'h010000 && address <= 24'h01000f;
    wire rom_selected = address >= 24'h008000 && address <= 24'h00ffff;
    cpu816_rom rom (.address(address[15:0]), .data(rom_data));
    assign read_data = !valid || write ? 8'hff :
        ram_selected ? ram[address[3:0]] : rom_selected ? rom_data : 8'hff;
    integer i;
    always @(posedge clk) begin
        if (reset) begin
            for (i = 0; i < 16; i = i + 1) ram[i] <= 0;
        end else if (valid && write && ram_selected)
            ram[address[3:0]] <= write_data;
    end
endmodule
