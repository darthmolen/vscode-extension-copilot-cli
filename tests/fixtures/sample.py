#!/usr/bin/env python3
"""
Sample data processing module for testing.
Reads a CSV-like file and computes statistics.
"""

import sys
from typing import Dict, List, Tuple


def read_data_file(filepath: str) -> List[Dict[str, str]]:
    """Read data from a CSV-like file and return as list of dictionaries."""
    records = []
    try:
        with open(filepath, 'r') as f:
            lines = f.readlines()
            if not lines:
                return records
            
            headers = [h.strip() for h in lines[0].split(',')]
            
            for line in lines[1:]:
                if line.strip():
                    values = [v.strip() for v in line.split(',')]
                    record = dict(zip(headers, values))
                    records.append(record)
    except FileNotFoundError:
        print(f"Error: File '{filepath}' not found")
        return []
    except Exception as e:
        print(f"Error reading file: {e}")
        return []
    
    return records


def calculate_statistics(data: List[Dict[str, str]], numeric_field: str) -> Tuple[float, float, float]:
    """Calculate min, max, and average for a numeric field."""
    values = []
    
    for record in data:
        if numeric_field in record:
            try:
                values.append(float(record[numeric_field]))
            except ValueError:
                continue
    
    if not values:
        return 0.0, 0.0, 0.0
    
    min_val = min(values)
    max_val = max(values)
    avg_val = sum(values) / len(values)
    
    return min_val, max_val, avg_val


def filter_by_category(data: List[Dict[str, str]], category_field: str, category_value: str) -> List[Dict[str, str]]:
    """Filter records by a specific category value."""
    return [record for record in data if record.get(category_field) == category_value]


def main():
    """Main entry point for data processing."""
    if len(sys.argv) < 2:
        print("Usage: python sample.py <datafile.csv>")
        sys.exit(1)
    
    filepath = sys.argv[1]
    data = read_data_file(filepath)
    
    if not data:
        print("No data loaded")
        sys.exit(1)
    
    print(f"Loaded {len(data)} records")
    
    if 'amount' in data[0]:
        min_amt, max_amt, avg_amt = calculate_statistics(data, 'amount')
        print(f"\nAmount Statistics:")
        print(f"  Min: {min_amt:.2f}")
        print(f"  Max: {max_amt:.2f}")
        print(f"  Avg: {avg_amt:.2f}")
    
    if 'category' in data[0]:
        categories = set(record.get('category', '') for record in data)
        print(f"\nCategories found: {', '.join(sorted(categories))}")


if __name__ == '__main__':
    main()
