// SPDX-License-Identifier: GPL-3.0-or-later
// 64x48, one pixel/clock, 3072 clocks/frame. CPU shares this rising-edge clock.
module backdrop_scanout (
    input clk, input reset, input [23:0] rgb,
    output reg video_valid, output reg [5:0] video_x, video_y,
    output reg [23:0] video_rgb, output reg video_last
);
    reg [5:0] x, y;
    reg [23:0] frame_rgb;
    always @(posedge clk) begin
        if (reset) begin
            x <= 0; y <= 0; frame_rgb <= 0;
            video_valid <= 0; video_last <= 0;
            video_x <= 0; video_y <= 0; video_rgb <= 0;
        end else begin
            video_valid <= 1;
            video_x <= x; video_y <= y;
            // Snapshot at the first pixel: even mid-frame CPU writes produce
            // solid completed frames. Same-edge PPU writes affect next frame.
            if (x == 0 && y == 0) begin
                frame_rgb <= rgb;
                video_rgb <= rgb;
            end else video_rgb <= frame_rgb;
            video_last <= (x == 63 && y == 47);
            if (x == 63) begin
                x <= 0;
                if (y == 47) y <= 0; else y <= y + 1'b1;
            end else x <= x + 1'b1;
        end
    end
endmodule
