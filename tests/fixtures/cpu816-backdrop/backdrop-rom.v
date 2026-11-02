// SPDX-License-Identifier: GPL-3.0-or-later
// Original redistributable program for this example; no game/firmware bytes.
module backdrop_rom (input [15:0] address, output reg [7:0] data);
    always @* begin
        case (address)
            16'h8000: data = 8'hd8; // CLD (reset emulation mode: 8-bit A/X/Y)
            16'h8001: data = 8'ha9; // LDA #$80 (forced blank)
            16'h8002: data = 8'h80;
            16'h8003: data = 8'h8d; // STA $2100
            16'h8004: data = 8'h00;
            16'h8005: data = 8'h21;
            16'h8006: data = 8'ha9; // LDA #0
            16'h8007: data = 8'h00;
            16'h8008: data = 8'h8d; // STA $2121 (CGRAM word 0)
            16'h8009: data = 8'h21;
            16'h800a: data = 8'h21;
            16'h800b: data = 8'ha9; // LDA #$1f (color low byte; edit here)
            16'h800c: data = 8'h1f;
            16'h800d: data = 8'h8d; // STA $2122
            16'h800e: data = 8'h22;
            16'h800f: data = 8'h21;
            16'h8010: data = 8'ha9; // LDA #$00 (color high byte; edit here)
            16'h8011: data = 8'h00;
            16'h8012: data = 8'h8d; // STA $2122
            16'h8013: data = 8'h22;
            16'h8014: data = 8'h21;
            16'h8015: data = 8'ha9; // LDA #$0f (display on, full brightness)
            16'h8016: data = 8'h0f;
            16'h8017: data = 8'h8d; // STA $2100
            16'h8018: data = 8'h00;
            16'h8019: data = 8'h21;
            16'h801a: data = 8'hdb; // STP (CPU stops; scanout continues)
            16'hfffc: data = 8'h00; // Reset -> $00:8000
            16'hfffd: data = 8'h80;
            default: data = 8'hdb; // STP
        endcase
    end
endmodule
