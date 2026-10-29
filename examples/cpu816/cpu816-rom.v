// SPDX-License-Identifier: GPL-3.0-or-later
// Original permitted test program, not a game/firmware ROM. Emulation M=X=1.
module cpu816_rom (input [15:0] address, output reg [7:0] data);
    always @* begin
        case (address)
            16'h8000: data = 8'h18; // CLC
            16'h8001: data = 8'hd8; // CLD
            16'h8002: data = 8'ha9; // LDA #$12
            16'h8003: data = 8'h12;
            16'h8004: data = 8'h69; // ADC #$34 -> $46
            16'h8005: data = 8'h34;
            16'h8006: data = 8'h8f; // STA $010000 (24-bit long address)
            16'h8007: data = 8'h00;
            16'h8008: data = 8'h00;
            16'h8009: data = 8'h01;
            16'h800a: data = 8'ha9; // LDA #0 (discard accumulator)
            16'h800b: data = 8'h00;
            16'h800c: data = 8'haf; // LDA $010000 (read RAM back)
            16'h800d: data = 8'h00;
            16'h800e: data = 8'h00;
            16'h800f: data = 8'h01;
            16'h8010: data = 8'hc9; // CMP #$46
            16'h8011: data = 8'h46;
            16'h8012: data = 8'hd0; // BNE fail ($801a)
            16'h8013: data = 8'h06;
            16'h8014: data = 8'ha9; // LDA #1
            16'h8015: data = 8'h01;
            16'h8016: data = 8'h8d; // STA $2000 (PASS mailbox)
            16'h8017: data = 8'h00;
            16'h8018: data = 8'h20;
            16'h8019: data = 8'hdb; // STP (board freezes on mailbox write)
            16'h801a: data = 8'ha9; // fail: LDA #$ff
            16'h801b: data = 8'hff;
            16'h801c: data = 8'h8d; // STA $2000 (FAIL mailbox)
            16'h801d: data = 8'h00;
            16'h801e: data = 8'h20;
            16'h801f: data = 8'hdb; // STP
            16'hfffc: data = 8'h00; // Emulation reset vector -> $00:8000
            16'hfffd: data = 8'h80;
            default: data = 8'hdb; // STP, then board timeout for bad control flow
        endcase
    end
endmodule
