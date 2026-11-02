module counter_next (
    input wire [7:0] current,
    output wire [7:0] next_count
);
    assign next_count = current + 8'd1;
endmodule
