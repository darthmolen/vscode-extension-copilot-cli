#!/bin/bash
# Reload the extension in VS Code

echo "Step 1: Compiling TypeScript..."
npm run compile

echo ""
echo "Step 2: The extension has been recompiled."
echo ""
echo "Next steps:"
echo "  1. In VS Code, press Ctrl+Shift+P (or Cmd+Shift+P on Mac)"
echo "  2. Type 'Developer: Reload Window'"
echo "  3. Press Enter"
echo ""
echo "This will reload the extension with the latest changes."
echo ""
echo "After reloading, when you enable plan mode, you should see:"
echo "  [Plan Mode] Tool Configuration:"
echo "  [Plan Mode]   Custom tools (3): update_work_plan, bash, create"
echo "  [Plan Mode]   Available tools (6): view, grep, glob, task, web_fetch, fetch_copilot_cli_documentation"
echo ""
