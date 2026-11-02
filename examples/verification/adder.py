"""Standalone Python: python3 adder.py. One row per post-reset clock."""
import csv
import sys

writer = csv.writer(sys.stdout)
writer.writerow(["a", "b", "sum"])
for index in range(16):
    a, b = index * 17, 255 - index * 11
    writer.writerow([a, b, sum([a, b])])
