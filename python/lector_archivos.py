#!/usr/bin/env python3
import os
import csv
import io
from datetime import datetime

def read_rows_from_file(file_path: str) -> list[dict]:
    """
    Reads a CSV or Excel (xlsx/xls) file and returns a list of dictionaries,
    where keys are column headers (cleaned, stripped, lowercase) and values are cell contents.
    For Excel files, dates are formatted to standard ZipGrade format strings
    so that date parsers can read them.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"No se encontró el archivo en la ruta: {file_path}")

    ext = os.path.splitext(file_path)[1].lower()

    if ext in ('.xlsx', '.xls'):
        import openpyxl
        wb = openpyxl.load_workbook(file_path, data_only=True)
        ws = wb.active

        # Extract rows
        rows = list(ws.iter_rows(values_only=False))
        if not rows:
            return []

        # Get headers from first row
        headers = []
        for cell in rows[0]:
            val = cell.value
            headers.append(str(val).strip() if val is not None else "")

        result = []
        for r in rows[1:]:
            # Skip completely empty rows
            if all(cell.value is None for cell in r):
                continue

            row_dict = {}
            for col_idx, cell in enumerate(r):
                if col_idx >= len(headers):
                    continue
                header = headers[col_idx]
                if not header:
                    continue

                val = cell.value
                if isinstance(val, datetime):
                    row_dict[header] = val.strftime('%Y/%m/%d %I:%M %p')
                elif val is None:
                    row_dict[header] = ""
                else:
                    row_dict[header] = str(val).strip()
            if row_dict:
                result.append(row_dict)
        return result
    else:
        # Assume CSV
        # Detect encoding
        encodings = ['utf-8', 'latin-1', 'cp1252']
        content = None
        for enc in encodings:
            try:
                with open(file_path, 'r', encoding=enc) as f:
                    content = f.read()
                break
            except UnicodeDecodeError:
                continue

        if content is None:
            raise ValueError("No se pudo leer el archivo con ninguna codificación soportada (UTF-8, Latin-1, CP1252).")

        # Detect delimiter
        try:
            delimiter = csv.Sniffer().sniff(content[:4096], delimiters=',;|\t').delimiter
        except Exception:
            delimiter = ','

        reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)
        
        # Clean header keys
        cleaned_rows = []
        for row in reader:
            # Skip empty rows
            if not any(row.values()):
                continue
            cleaned_row = {}
            for k, v in row.items():
                if k is not None:
                    cleaned_row[k.strip()] = v.strip() if v is not None else ""
            cleaned_rows.append(cleaned_row)
        return cleaned_rows
