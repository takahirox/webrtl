// SPDX-License-Identifier: GPL-3.0-or-later
// Real CPU bus -> minimal PPU -> existing Video interface. No JS CPU/device.
module cpu816_bg1 (
    input clk, input reset,
    output video_valid, output [5:0] video_x, video_y,
    output [23:0] video_rgb, output video_last
);
    wire [23:0] address;
    wire [7:0] data_in, data_out, rom_data;
    wire we_n, vpa, vda;
    wire valid = vpa || vda;
    wire write = valid && !we_n;
    wire [23:0] bg1_rgb;
    wire [7:0] inidisp;
    wire [5:0] x, y;

    P65C816 cpu (
        .CLK(clk), .RST_N(!reset), .CE(1'b1), .RDY_IN(1'b1),
        .NMI_N(1'b1), .IRQ_N(1'b1), .ABORT_N(1'b1),
        .D_IN(data_in), .D_OUT(data_out), .A_OUT(address), .WE(we_n),
        .VPA(vpa), .VDA(vda), .RDY_OUT(), .MLB(), .VPB(), .I_FLAG()
    );
    bg1_rom rom (.address(address[15:0]), .data(rom_data));
    // Same asynchronous bank-00 ROM/read qualification as the #16 harness.
    // PPU reads, RAM/stack writes and all unmapped accesses are unsupported.
    assign data_in = valid && !write && address >= 24'h008000 &&
        address <= 24'h00ffff ? rom_data : 8'hff;
    bg1_ppu ppu (
        .clk(clk), .reset(reset), .write(write), .address(address), .data(data_out),
        .x(x), .y(y), .inidisp(inidisp), .rgb(bg1_rgb)
    );
    bg1_scanout scanout (
        .clk(clk), .reset(reset), .rgb(bg1_rgb), .blank(inidisp[7]), .x(x), .y(y),
        .video_valid(video_valid), .video_x(video_x), .video_y(video_y),
        .video_rgb(video_rgb), .video_last(video_last)
    );
endmodule
