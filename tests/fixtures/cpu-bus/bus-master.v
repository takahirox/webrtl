// Synthesizable test sequencer, not a CPU. Copy ROM XOR a5 into RAM, then verify
// all four RAM bytes against independent known values. Halt until reset.
module bus_master(
    input clk,
    input reset,
    output reg valid,
    output reg write,
    output reg [15:0] address,
    output [7:0] write_data,
    input [7:0] read_data,
    output reg [7:0] result
);
    localparam READ_ROM = 3'd0, WRITE_RAM = 3'd1, VERIFY_RAM = 3'd2,
               COMPLETE = 3'd3, HALT = 3'd4;
    reg [2:0] state;
    reg [1:0] index;
    reg [7:0] copied_byte;
    reg [7:0] expected;

    assign write_data = copied_byte;
    always @* begin
        case (index)
            2'd0: expected = 8'hb7;
            2'd1: expected = 8'h91;
            2'd2: expected = 8'hf3;
            2'd3: expected = 8'hdd;
            default: expected = 8'h00;
        endcase
        valid = 1'b0;
        write = 1'b0;
        address = 16'h0000;
        if (!reset) begin
            case (state)
                READ_ROM: begin
                    valid = 1'b1;
                    address = {14'h0000, index};
                end
                WRITE_RAM: begin
                    valid = 1'b1;
                    write = 1'b1;
                    address = {14'h0040, index};
                end
                VERIFY_RAM: begin
                    valid = 1'b1;
                    address = {14'h0040, index};
                end
                default: begin end
            endcase
        end
    end

    always @(posedge clk) begin
        if (reset) begin
            state <= READ_ROM;
            index <= 2'd0;
            copied_byte <= 8'h00;
            result <= 8'h00;
        end else begin
            case (state)
                READ_ROM: begin
                    copied_byte <= read_data ^ 8'ha5;
                    result <= read_data;
                    state <= WRITE_RAM;
                end
                WRITE_RAM: begin
                    result <= write_data;
                    if (index == 2'd3) begin
                        index <= 2'd0;
                        state <= VERIFY_RAM;
                    end else begin
                        index <= index + 2'd1;
                        state <= READ_ROM;
                    end
                end
                VERIFY_RAM: begin
                    if (read_data != expected) begin
                        result <= 8'hff;
                        state <= HALT;
                    end else begin
                        result <= read_data;
                        if (index == 2'd3)
                            state <= COMPLETE;
                        else
                            index <= index + 2'd1;
                    end
                end
                COMPLETE: begin
                    result <= 8'h01;
                    state <= HALT;
                end
                default: state <= HALT;
            endcase
        end
    end
endmodule
