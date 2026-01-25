"""Simple MCP server for testing Copilot CLI Extension MCP integration."""

from fastmcp import FastMCP

# Initialize the MCP server
mcp = FastMCP("hello-mcp")

# Test data store
TEST_DATA = {
    "sample": {
        "type": "sample",
        "content": "This is sample test data",
        "id": 1,
        "active": True
    },
    "config": {
        "type": "config",
        "settings": {
            "timeout": 30,
            "retries": 3,
            "verbose": True
        },
        "version": "1.0.0"
    },
    "metadata": {
        "type": "metadata",
        "description": "Test metadata for validation",
        "tags": ["test", "mcp", "integration"],
        "timestamp": "2024-01-01T00:00:00Z"
    }
}


@mcp.tool()
def get_test_data(key: str) -> dict:
    """
    Returns test data based on the provided key.
    
    Args:
        key: The key to retrieve data for. Valid values: "sample", "config", "metadata"
    
    Returns:
        Dictionary containing the test data for the specified key
    
    Raises:
        KeyError: If the key is not found in test data
    """
    if key not in TEST_DATA:
        available_keys = ", ".join(TEST_DATA.keys())
        raise KeyError(f"Key '{key}' not found. Available keys: {available_keys}")
    
    return TEST_DATA[key]


@mcp.tool()
def validate_format(content: str, format_type: str) -> dict:
    """
    Validates if content matches the specified format type.
    
    Args:
        content: The content string to validate
        format_type: The format to validate against ("markdown", "python", "json", "csharp")
    
    Returns:
        Dictionary with validation result containing:
        - valid: Boolean indicating if content is valid
        - format: The format type that was checked
        - details: Additional details about validation
    """
    import json
    
    result = {
        "valid": False,
        "format": format_type,
        "details": ""
    }
    
    if format_type == "json":
        try:
            json.loads(content)
            result["valid"] = True
            result["details"] = "Valid JSON structure"
        except json.JSONDecodeError as e:
            result["details"] = f"Invalid JSON: {str(e)}"
    
    elif format_type == "markdown":
        # Simple markdown validation - check for common markdown elements
        markdown_indicators = ["#", "*", "-", "[", "]", "`"]
        has_markdown = any(indicator in content for indicator in markdown_indicators)
        result["valid"] = has_markdown or len(content.strip()) > 0
        result["details"] = "Contains markdown indicators" if has_markdown else "Plain text (valid as markdown)"
    
    elif format_type == "python":
        # Basic Python syntax check
        try:
            compile(content, '<string>', 'exec')
            result["valid"] = True
            result["details"] = "Valid Python syntax"
        except SyntaxError as e:
            result["details"] = f"Python syntax error: {str(e)}"
    
    elif format_type == "csharp":
        # Basic C# validation - check for common patterns
        csharp_indicators = ["class ", "namespace ", "using ", "public ", "private ", "{", "}", ";"]
        has_csharp = any(indicator in content for indicator in csharp_indicators)
        result["valid"] = has_csharp
        result["details"] = "Contains C# code patterns" if has_csharp else "No C# patterns detected"
    
    else:
        result["details"] = f"Unknown format type: {format_type}. Supported: markdown, python, json, csharp"
    
    return result


if __name__ == "__main__":
    # Run the MCP server
    mcp.run()
