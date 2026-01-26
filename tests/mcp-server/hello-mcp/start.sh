#!/bin/bash
# Quick start script for the Hello MCP server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Starting Hello MCP Server..."
echo "Server directory: $SCRIPT_DIR"
echo ""
echo "Tools available:"
echo "  - get_test_data(key: str)"
echo "  - validate_format(content: str, format_type: str)"
echo ""
echo "Press Ctrl+C to stop the server"
echo "=========================================="
echo ""

exec venv/bin/python server.py "$@"
