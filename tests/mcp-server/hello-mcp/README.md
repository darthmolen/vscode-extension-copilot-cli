# Hello MCP Server

Simple MCP (Model Context Protocol) server for testing Copilot CLI Extension v2 MCP integration.

## Structure

```
tests/mcp-server/hello-mcp/
├── __init__.py           # Package initialization
├── server.py             # Main MCP server implementation
├── requirements.txt      # Dependencies (fastmcp)
├── test_tools.py         # Test script for tools
├── venv/                 # Virtual environment (created during setup)
└── README.md            # This file
```

## Installation

The virtual environment and dependencies are already set up. If you need to recreate:

```bash
cd tests/mcp-server/hello-mcp
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

## Available Tools

### 1. `get_test_data(key: str)`

Returns test data based on the provided key.

**Valid keys:**
- `"sample"` - Sample test data with basic fields
- `"config"` - Configuration data with settings
- `"metadata"` - Metadata with tags and timestamp

**Returns:** Dictionary containing the test data

**Example:**
```python
get_test_data("sample")
# Returns: {"type": "sample", "content": "This is sample test data", "id": 1, "active": True}
```

### 2. `validate_format(content: str, format_type: str)`

Validates if content matches the specified format type.

**Supported formats:**
- `"json"` - Validates JSON syntax
- `"python"` - Validates Python syntax
- `"markdown"` - Checks for markdown indicators
- `"csharp"` - Checks for C# code patterns

**Returns:** Dictionary with:
- `valid` (bool) - Whether the content is valid
- `format` (str) - The format that was checked
- `details` (str) - Additional information about validation

**Example:**
```python
validate_format('{"test": "data"}', "json")
# Returns: {"valid": True, "format": "json", "details": "Valid JSON structure"}
```

## Running the Server

### Standard mode (stdio transport for MCP):

```bash
cd tests/mcp-server/hello-mcp
venv/bin/python server.py
```

The server will start and communicate via stdio, which is the standard MCP transport.

### Testing the Tools

Run the test script to verify tools work correctly:

```bash
cd tests/mcp-server/hello-mcp
venv/bin/python test_tools.py
```

Expected output:
```
============================================================
Testing Hello MCP Server Functions
============================================================
Testing get_test_data...
  ✓ sample: sample
  ✓ config: config
  ✓ metadata: metadata
  ✓ Invalid key handling works

Testing validate_format...
  ✓ JSON validation works
  ✓ Python validation works
  ✓ Markdown validation works
  ✓ C# validation works

============================================================
✓ All tests passed!
============================================================
```

## Integration with Copilot CLI Extension

To use this server with the VS Code Copilot CLI Extension:

1. Configure the MCP server in VS Code settings or MCP config file
2. Point to the server executable: `tests/mcp-server/hello-mcp/venv/bin/python`
3. Set the script path: `tests/mcp-server/hello-mcp/server.py`

The extension should be able to discover and use the two tools:
- `get_test_data`
- `validate_format`

## Development

The server uses `fastmcp` which provides:
- Automatic tool registration via decorators
- Stdio transport for MCP protocol
- Type validation from function signatures
- Automatic help text from docstrings

To add more tools, simply add decorated functions in `server.py`:

```python
@mcp.tool()
def your_tool_name(param: str) -> dict:
    """Tool description."""
    # Implementation
    return {"result": "data"}
```

## Dependencies

- `fastmcp>=2.14.0` - FastMCP library for building MCP servers
- Python 3.8+

## Notes

- The server runs in stdio mode by default (MCP standard)
- All tools return dictionaries for easy JSON serialization
- Error handling includes descriptive messages
- Simple validation logic suitable for testing integration
