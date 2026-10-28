// 64 x 48 RGB888, one pixel per rising edge, 60 frames/s at 184320 Hz.
module video(
    input clk, input reset,
    output reg video_valid, output reg [5:0] video_x, video_y,
    output reg [23:0] video_rgb, output reg video_last
);
    reg [5:0] x, y;
    always @(posedge clk) begin
        if (reset) begin
            x <= 0; y <= 0;
            video_valid <= 0; video_last <= 0;
            video_x <= 0; video_y <= 0; video_rgb <= 0;
        end else begin
            video_valid <= 1;
            video_x <= x; video_y <= y;
            // Edit these RTL colors and recompile to change the canvas.
            if (x < 16) video_rgb <= 24'hff0000;
            else if (x < 32) video_rgb <= 24'h00ff00;
            else if (x < 48) video_rgb <= 24'h0000ff;
            else video_rgb <= 24'hffffff;
            video_last <= (x == 63 && y == 47);
            if (x == 63) begin
                x <= 0;
                if (y == 47) y <= 0; else y <= y + 1;
            end else x <= x + 1;
        end
    end
endmodule
