module split_counter (
    input wire clk,
    input wire reset,
    output reg [7:0] count
);
    wire [7:0] next_count;
    counter_next helper (.current(count), .next_count(next_count));

    always @(posedge clk) begin
        if (reset)
            count <= 8'd0;
        else
            count <= next_count;
    end
endmodule
