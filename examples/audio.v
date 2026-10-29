// Mono signed PCM16: one sample every six 48000 Hz clocks = 8000 samples/s.
module audio(
    input clk, input reset,
    output reg audio_valid, output reg signed [15:0] audio_sample
);
    reg [2:0] divider;
    reg [4:0] phase;
    always @(posedge clk) begin
        if (reset) begin
            divider <= 0; phase <= 0;
            audio_valid <= 0; audio_sample <= 0;
        end else begin
            audio_valid <= 0;
            if (divider == 5) begin
                divider <= 0;
                audio_valid <= 1;
                // 20 samples per period = 400 Hz. Edit amplitude/phase here.
                if (phase < 10) audio_sample <= 16'sd8192;
                else audio_sample <= -16'sd8192;
                if (phase == 19) phase <= 0; else phase <= phase + 1;
            end else divider <= divider + 1;
        end
    end
endmodule
