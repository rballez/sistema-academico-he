#!/usr/bin/env python3
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lector_archivos

for filename in ['ROTACIONES.xlsx', 'EXAMENES.xlsx']:
    path = os.path.join('/Users/rbz/Desktop/HE-APP/assets', filename)
    print(f"=== {filename} ===")
    if not os.path.exists(path):
        print(f"File not found: {path}")
        continue
    try:
        rows = lector_archivos.read_rows_from_file(path)
        print(f"Total rows read: {len(rows)}")
        if rows:
            print("Headers in dictionary:", list(rows[0].keys()))
            print("Row 1:", rows[0])
            if len(rows) > 1:
                print("Row 2:", rows[1])
        else:
            print("No rows returned!")
    except Exception as e:
        print(f"Error reading {filename}: {e}")
    print()
