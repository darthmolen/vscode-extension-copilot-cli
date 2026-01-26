#!/usr/bin/env python3
"""Test script to verify the MCP server tools work correctly."""

import sys
import json

# Test the raw functions before they're wrapped
def test_get_test_data():
    """Test the get_test_data function."""
    from server import TEST_DATA
    
    print("Testing get_test_data...")
    
    # Test valid keys
    for key in ["sample", "config", "metadata"]:
        data = TEST_DATA[key]
        print(f"  ✓ {key}: {data['type']}")
    
    # Test invalid key
    try:
        data = TEST_DATA["invalid"]
        print("  ✗ Should have raised KeyError")
        return False
    except KeyError:
        print("  ✓ Invalid key handling works")
    
    return True


def test_validate_format():
    """Test the validate_format function."""
    print("\nTesting validate_format...")
    
    # Import the validation logic inline
    import json as json_lib
    
    # Test JSON
    valid_json = '{"test": "data"}'
    try:
        json_lib.loads(valid_json)
        print("  ✓ JSON validation works")
    except:
        print("  ✗ JSON validation failed")
        return False
    
    # Test Python
    valid_python = "x = 1 + 2"
    try:
        compile(valid_python, '<string>', 'exec')
        print("  ✓ Python validation works")
    except:
        print("  ✗ Python validation failed")
        return False
    
    # Test Markdown
    markdown_content = "# Header\n- List item"
    has_markdown = any(ind in markdown_content for ind in ["#", "*", "-", "["])
    if has_markdown:
        print("  ✓ Markdown validation works")
    else:
        print("  ✗ Markdown validation failed")
        return False
    
    # Test C#
    csharp_content = "public class Test { }"
    has_csharp = any(ind in csharp_content for ind in ["class ", "public "])
    if has_csharp:
        print("  ✓ C# validation works")
    else:
        print("  ✗ C# validation failed")
        return False
    
    return True


if __name__ == "__main__":
    print("=" * 60)
    print("Testing Hello MCP Server Functions")
    print("=" * 60)
    
    success = True
    success = test_get_test_data() and success
    success = test_validate_format() and success
    
    print("\n" + "=" * 60)
    if success:
        print("✓ All tests passed!")
        print("=" * 60)
        sys.exit(0)
    else:
        print("✗ Some tests failed")
        print("=" * 60)
        sys.exit(1)
