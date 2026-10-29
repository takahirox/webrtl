// WebRTL SNES board. GPL-3.0-or-later.
// Memories, cartridge mapping and serial controller hardware all live in RTL.
module snes (
    input clk, input reset,
    input cart_write, input [21:0] cart_address, input [7:0] cart_data,
    input cart_hirom, input [21:0] cart_mask,
    input [3:0] cart_ram_size,
    input [11:0] buttons,
    output ready,
    output video_valid, output [8:0] video_x, output [8:0] video_y,
    output [8:0] video_height,
    output [23:0] video_rgb, output video_last,
    output audio_valid, output signed [15:0] audio_sample,
    output [23:0] trace_address, output [7:0] trace_data,
    output [3:0] trace_flags
);
    // Reset scrubs RAM serially, avoiding a giant reset mux on every RAM bit.
    reg [17:0] clearing = 0;
    assign ready = clearing == 18'd131072 && !reset;
    always @(posedge clk) begin
        if (reset) clearing <= 0;
        else if (!ready) clearing <= clearing + 1'b1;
    end

    reg [7:0] rom [0:4194303];
    reg [7:0] wram [0:131071];
    reg [7:0] aram [0:65535];
    reg [7:0] vram_a [0:32767], vram_b [0:32767];
    reg [7:0] sram [0:131071];
    wire [23:0] ca;
    wire [7:0] data_out, pa;
    wire read_n, write_n, romsel_n, sysclk, pa_write_n;
    wire [16:0] wa;
    wire [15:0] aa, va, vb;
    wire [7:0] wd, ad, vda, vdb;
    wire wce, wwe, ace, awe, vwea, vweb;
    reg [7:0] wq, aq, vqa, vqb, cart_memory_q;
    wire [21:0] rom_address = (cart_hirom ? ca[21:0] : {ca[22:16],ca[14:0]}) & cart_mask;
    wire sram_select = cart_ram_size != 0 && (cart_hirom
        ? !ca[22] && ca[15:13] == 3'b011 && ca[21]
        : ca[22:20] == 3'b111 && !ca[15] && ca[23:16] != 8'h7e && ca[23:16] != 8'h7f);
    // LoROM's $70-$7d/$f0-$ff lower halves are SRAM or undriven, never ROM.
    wire rom_select = !romsel_n && (cart_hirom || ca[15] || ca[22:20] != 3'b111);
    // DO exposes the CPU memory data register, retaining the last bus value.
    wire [7:0] cart_q = sram_select || rom_select ? cart_memory_q : data_out;
    wire [16:0] sram_mask = 17'((18'd1024 << cart_ram_size) - 1'b1);
    wire [16:0] sa = (cart_hirom ? {ca[19:16],ca[12:0]} : {ca[17:16],ca[14:0]}) & sram_mask;
    always @(posedge clk) begin
        if (cart_write) rom[cart_address] <= cart_data;
        cart_memory_q <= sram_select ? sram[sa] : rom[rom_address];
        wq <= wram[wa]; aq <= aram[aa];
        vqa <= vram_a[va[14:0]]; vqb <= vram_b[vb[14:0]];
        if (!ready) begin
            wram[clearing[16:0]] <= 0;
            aram[clearing[15:0]] <= 0;
            vram_a[clearing[14:0]] <= 0;
            vram_b[clearing[14:0]] <= 0;
            sram[clearing[16:0]] <= 0;
        end else begin
            if (!wce && !wwe) wram[wa] <= wd;
            if (!ace && !awe) aram[aa] <= ad;
            if (!vwea) vram_a[va[14:0]] <= vda;
            if (!vweb) vram_b[vb[14:0]] <= vdb;
            if (sram_select && !write_n) sram[sa] <= data_out;
        end
    end

    wire strobe, joyclk;
    reg joyclk_old;
    reg [15:0] joy;
    always @(posedge clk) begin
        joyclk_old <= joyclk;
        if (!ready || strobe) joy <= {~buttons,4'b1111};
        else if (joyclk_old && !joyclk) joy <= {joy[14:0],1'b0};
    end

    wire [14:0] rgb;
    wire hde, vde, dotclk, interlace, v224, field;
    wire [8:0] x, y;
    wire [15:0] left, right;
    wire sample_ready;
    reg dot_old, sample_old, vde_old;
    always @(posedge clk) begin dot_old <= dotclk; sample_old <= sample_ready; vde_old <= vde; end
    assign video_valid = ready && hde && vde && y[7:0] < (v224 ? 8'd224 : 8'd239) && dot_old != dotclk;
    assign video_x = x;
    assign video_y = interlace ? {y[7:0],y[8]} : {1'b0,y[7:0]};
    assign video_height = interlace ? (v224 ? 9'd448 : 9'd478) : (v224 ? 9'd224 : 9'd239);
    assign video_rgb = {rgb[4:0],rgb[4:2],rgb[9:5],rgb[9:7],rgb[14:10],rgb[14:12]};
    assign video_last = ready && vde_old && !vde && (!interlace || field);
    assign audio_valid = ready && sample_ready && !sample_old;
    // Mono downmix of the actual stereo DSP outputs (no host synthesis).
    wire signed [16:0] mixed = {left[15],left} + $signed({right[15],right});
    assign audio_sample = mixed[16:1];
    assign trace_address = !pa_write_n ? {16'h0021,pa} : ca;
    assign trace_data = !read_n ? cart_q : data_out;
    assign trace_flags = {ready && sysclk && (!read_n || !write_n || !pa_write_n),2'b00,(!write_n || !pa_write_n)};

    SNES console (
        .MCLK(clk), .RST_N(ready), .ENABLE(1'b1), .PAL(1'b0), .BLEND(1'b0), .DIS_SHORTLINE(1'b0),
        .CA(ca), .CPURD_N(read_n), .CPUWR_N(write_n), .CPURD_CYC_N(), .DOT_CLK_CE(),
        .PA(pa), .PARD_N(), .PAWR_N(pa_write_n), .DI(cart_q), .DO(data_out),
        .RAMSEL_N(), .ROMSEL_N(romsel_n), .SYSCLKF_CE(sysclk), .SYSCLKR_CE(), .SNES_REFRESH(), .IRQ_N(1'b1),
        .WRAM_ADDR(wa), .WRAM_D(wd), .WRAM_Q(wq), .WRAM_CE_N(wce), .WRAM_WE_N(wwe), .WRAM_OE_N(), .WRAM_RD_N(),
        .VRAM_ADDRA(va), .VRAM_ADDRB(vb), .VRAM_DAI(vqa), .VRAM_DBI(vqb), .VRAM_DAO(vda), .VRAM_DBO(vdb),
        .VRAM_WRA_N(vwea), .VRAM_WRB_N(vweb), .VRAM_RD_N(),
        .ARAM_ADDR(aa), .ARAM_D(ad), .ARAM_Q(aq), .ARAM_CE_N(ace), .ARAM_OE_N(), .ARAM_WE_N(awe),
        .HIGH_RES(), .FIELD_OUT(field), .INTERLACE(interlace), .V224_MODE(v224), .DOTCLK(dotclk),
        .RGB_OUT(rgb), .HDE(hde), .VDE(vde), .HSYNC(), .VSYNC(), .X_OUT(x), .Y_OUT(y),
        .JOY1_DI({1'b1,joy[15]}), .JOY2_DI(2'b11), .JOY_STRB(strobe), .JOY1_CLK(joyclk), .JOY2_CLK(),
        .AUDIO_L(left), .AUDIO_R(right), .AUDIO_READY(sample_ready), .AUDIO_EN(1'b1),
        .DBG_SEL(8'd0), .DBG_REG(8'd0), .DBG_REG_WR(1'b0), .DBG_DAT_IN(8'd0), .DBG_DAT_OUT(), .DBG_BREAK()
    );
endmodule
