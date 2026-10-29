// SPDX-License-Identifier: GPL-3.0-or-later
// SNES-inspired write-only subset; only CGRAM word 0 is stored.
module backdrop_ppu (
    input clk, input reset, input write,
    input [23:0] address, input [7:0] data,
    output reg [7:0] inidisp, cgaddr, cg_low,
    output reg cg_high, output reg [14:0] backdrop,
    output [23:0] rgb
);
    // Explicit approximation: replicate 5 bits to 8, then floor(channel*b/15).
    // This is linear digital scaling, not a model of the SNES analog DAC.
    function [7:0] channel;
        input [4:0] value;
        input [3:0] brightness;
        reg [7:0] expanded;
        reg [11:0] scaled;
        begin
            expanded = {value, value[4:2]};
            scaled = expanded * brightness;
            channel = scaled / 12'd15;
        end
    endfunction
    assign rgb = inidisp[7] ? 24'h000000 : {
        channel(backdrop[4:0], inidisp[3:0]),
        channel(backdrop[9:5], inidisp[3:0]),
        channel(backdrop[14:10], inidisp[3:0])};

    always @(posedge clk) begin
        if (reset) begin
            inidisp <= 8'h80;
            cgaddr <= 0; cg_low <= 0; cg_high <= 0; backdrop <= 0;
        end else if (write) begin
            // Full 24-bit decode: other banks cannot alias these registers.
            case (address)
                24'h002100: inidisp <= data & 8'h8f;
                24'h002121: begin
                    cgaddr <= data;
                    cg_high <= 0; // CGADD restarts the low/high pair.
                    cg_low <= 0;
                end
                24'h002122: begin
                    if (!cg_high) begin
                        cg_low <= data;
                        cg_high <= 1;
                    end else begin
                        if (cgaddr == 0) backdrop <= {data[6:0], cg_low};
                        cgaddr <= cgaddr + 1'b1;
                        cg_high <= 0;
                    end
                end
                default: begin end
            endcase
        end
    end
endmodule
