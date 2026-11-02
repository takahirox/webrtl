// Standalone C++17: clang++ adder.cpp -o reference && ./reference
// Emit equivalent stimulus and independently computed expectations as plain CSV.
#include <cstdio>
int main() {
  std::puts("a,b,sum");
  for (unsigned i = 0; i < 16; ++i) {
    unsigned a = i * 17, b = 255 - i * 11;
    std::printf("%u,%u,%u\n", a, b, a + b);
  }
}
