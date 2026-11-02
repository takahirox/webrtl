// SPDX-License-Identifier: GPL-3.0-or-later
// One pixel per shared CPU/PPU clock; publish only complete 64x48 frames.
module bg1_scanout (
    input clk, input reset, input [23:0] rgb, input blank,
    output reg [5:0] x, y,
    output reg video_valid, output reg [5:0] video_x, video_y,
    output reg [23:0] video_rgb, output reg video_last
);
    reg frame_blank;
    always @(posedge clk) begin
        if (reset) begin
            x <= 0; y <= 0; frame_blank <= 1;
            video_valid <= 0; video_last <= 0;
            video_x <= 0; video_y <= 0; video_rgb <= 0;
        end else begin
            video_valid <= 1; video_x <= x; video_y <= y;
            // Keep an initialization frame blank even if the CPU unblanks it.
            if (x == 0 && y == 0) begin
                frame_blank <= blank;
                video_rgb <= blank ? 24'd0 : rgb;
            end else video_rgb <= frame_blank ? 24'd0 : rgb;
            video_last <= (x == 63 && y == 47);
            if (x == 63) begin
                x <= 0;
                if (y == 47) y <= 0; else y <= y + 1'b1;
            end else x <= x + 1'b1;
        end
    end
endmodule
