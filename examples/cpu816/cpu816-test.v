// SPDX-License-Identifier: GPL-3.0-or-later
// Small board around the actual P65C816 bus. No instruction decoding here.
module cpu816_test (
    input clk, input reset,
    output reg [7:0] result,
    output reg [23:0] trace_address,
    output reg [7:0] trace_data,
    output reg [3:0] trace_flags
);
    wire [23:0] address;
    wire [7:0] data_in, data_out;
    wire we_n, vpa, vda;
    wire enabled = result == 0;
    wire valid = enabled && (vpa || vda);
    wire write = valid && !we_n;
    reg [11:0] elapsed;

    P65C816 cpu (
        .CLK(clk), .RST_N(!reset), .CE(enabled), .RDY_IN(1'b1),
        .NMI_N(1'b1), .IRQ_N(1'b1), .ABORT_N(1'b1),
        .D_IN(data_in), .D_OUT(data_out), .A_OUT(address), .WE(we_n),
        .VPA(vpa), .VDA(vda), .RDY_OUT(), .MLB(), .VPB(), .I_FLAG()
    );
    cpu816_memory memory_bus (
        .clk(clk), .reset(reset), .valid(valid), .write(write),
        .address(address), .write_data(data_out), .read_data(data_in)
    );

    always @(posedge clk) begin
        if (reset) begin
            result <= 0;
            elapsed <= 0;
            trace_address <= 0;
            trace_data <= 0;
            trace_flags <= 0;
        end else begin
            // Sample the bus that this edge consumes, rather than the next
            // combinational CPU phase. bit 3=valid, 2=VPA, 1=VDA, 0=write.
            trace_address <= address;
            trace_data <= write ? data_out : data_in;
            trace_flags <= {valid, vpa, vda, write};
            if (enabled) begin
                elapsed <= elapsed + 1'b1;
                if (write && address == 24'h002000)
                    result <= data_out == 8'h01 ? 8'h01 : 8'hff;
                else if (elapsed == 12'hfff)
                    result <= 8'hff; // Bounded failure for a stopped/looping ROM.
            end
        end
    end
endmodule
