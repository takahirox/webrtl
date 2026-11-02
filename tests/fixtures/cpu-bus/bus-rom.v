// Four inline bytes, combinational read. The decoder protects this address range
// from writes; there is no browser filesystem or $readmemh dependency.
module bus_rom(
    input [1:0] address,
    output reg [7:0] read_data
);
    always @* begin
        case (address)
            2'd0: read_data = 8'h12;
            2'd1: read_data = 8'h34;
            2'd2: read_data = 8'h56;
            2'd3: read_data = 8'h78;
            default: read_data = 8'h00;
        endcase
    end
endmodule
