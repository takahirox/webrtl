// SPDX-License-Identifier: GPL-3.0-or-later
// Deliberately sparse, RTL-owned VRAM. See docs/cpu816-bg1.md for the subset.
module bg1_ppu (
    input clk, input reset, input write,
    input [23:0] address, input [7:0] data,
    input [5:0] x, y,
    output reg [7:0] inidisp,
    output [23:0] rgb
);
    reg [7:0] bgmode, bg1sc, bg12nba, vmain;
    reg [15:0] vmadd;
    reg [7:0] cgaddr, cg_low;
    reg cg_high;
    reg [15:0] characters [0:15]; // two 8x8 2bpp tiles, words $0000..$000f
    reg [15:0] tilemap [0:1];    // words $0400..$0401
    reg [14:0] cgram [0:31];     // backdrop + all eight BG1 2bpp palettes
    integer i;

    function [15:0] vram_read;
        input [15:0] word_address;
        begin
            if (word_address < 16) vram_read = characters[word_address[3:0]];
            else if (word_address == 16'h0400 || word_address == 16'h0401)
                vram_read = tilemap[word_address[0]];
            else vram_read = 0;
        end
    endfunction
    wire [15:0] increment = vmain[1:0] == 0 ? 16'd1 :
        vmain[1:0] == 1 ? 16'd32 : 16'd128;
    // SNES 32-column map, 8x8 tiles. Unstored entries read as tile 0.
    wire [15:0] map_address = {bg1sc[7:2], 10'b0} +
        {8'b0, y[5:3], 5'b0} + {13'b0, x[5:3]};
    wire [15:0] entry = vram_read(map_address);
    wire [2:0] tile_y = y[2:0] ^ {3{entry[15]}};
    wire [2:0] tile_x = x[2:0] ^ {3{entry[14]}};
    wire [15:0] character_address = {bg12nba[3:0], 12'b0} +
        {3'b0, entry[9:0], 3'b0} + {13'b0, tile_y};
    wire [15:0] planes = vram_read(character_address);
    wire [2:0] bit_index = 3'd7 - tile_x;
    wire [1:0] pixel = {planes[8 + bit_index], planes[bit_index]};
    wire enabled = bgmode[2:0] == 0 && !bgmode[4];
    wire [4:0] palette_index = !enabled || pixel == 0 ? 5'd0 : {entry[12:10], pixel};
    wire [14:0] color = cgram[palette_index];
    function [7:0] channel;
        input [4:0] value;
        input [3:0] brightness;
        reg [11:0] scaled;
        begin
            scaled = {value, value[4:2]} * brightness;
            channel = scaled / 12'd15;
        end
    endfunction
    assign rgb = inidisp[7] ? 24'h000000 : {
        channel(color[4:0], inidisp[3:0]),
        channel(color[9:5], inidisp[3:0]),
        channel(color[14:10], inidisp[3:0])};

    always @(posedge clk) begin
        if (reset) begin
            inidisp <= 8'h80;
            bgmode <= 0; bg1sc <= 0; bg12nba <= 0; vmain <= 0; vmadd <= 0;
            cgaddr <= 0; cg_low <= 0; cg_high <= 0;
            for (i = 0; i < 16; i = i + 1) characters[i] <= 0;
            for (i = 0; i < 2; i = i + 1) tilemap[i] <= 0;
            for (i = 0; i < 32; i = i + 1) cgram[i] <= 0;
        end else if (write) begin
            case (address) // full bank-00 decode; no console mirrors
                24'h002100: inidisp <= data & 8'h8f;
                24'h002105: bgmode <= data;
                24'h002107: bg1sc <= data & 8'hfc;
                24'h00210b: bg12nba <= data & 8'h0f;
                24'h002115: vmain <= data & 8'h83;
                24'h002116: vmadd[7:0] <= data;
                24'h002117: vmadd[15:8] <= data;
                24'h002118, 24'h002119: begin
                    if (vmadd < 16) begin
                        if (address[0]) characters[vmadd[3:0]][15:8] <= data;
                        else characters[vmadd[3:0]][7:0] <= data;
                    end else if (vmadd == 16'h0400 || vmadd == 16'h0401) begin
                        if (address[0]) tilemap[vmadd[0]][15:8] <= data;
                        else tilemap[vmadd[0]][7:0] <= data;
                    end
                    if (address[0] == vmain[7]) vmadd <= vmadd + increment;
                end
                24'h002121: begin cgaddr <= data; cg_low <= 0; cg_high <= 0; end
                24'h002122: begin
                    if (!cg_high) begin cg_low <= data; cg_high <= 1; end
                    else begin
                        if (cgaddr < 32) cgram[cgaddr[4:0]] <= {data[6:0], cg_low};
                        cgaddr <= cgaddr + 1'b1;
                        cg_high <= 0;
                    end
                end
                default: begin end
            endcase
        end
    end
endmodule
