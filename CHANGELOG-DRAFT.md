# v2.0.0 Release Notes (Draft)

## Major Features

### ✨ SDK 2.0 Integration
- Built on official @github/copilot-sdk for production-ready agent runtime
- Real-time streaming with `assistant.message_delta` events
- Reasoning visibility with `assistant.reasoning_delta` events
- Event-driven architecture with JSON-RPC

### 🔧 Tool Execution Visibility
- Inline tool execution display with status indicators
- View tool arguments, results, and errors
- Collapsible details for each tool execution
- Smart argument formatting per tool type

### 📄 File Diff Viewing
- "View Diff" button on edit/create tool executions
- Before/after comparison using VS Code diff viewer
- Temp file storage with automatic cleanup
- Smart memory management

### 🎯 Planning Mode
- Toggle to auto-prefix messages with [[PLAN]]
- "View Plan" button to open plan.md in editor
- Visible when infinite sessions enabled
- Clean UI with plan controls above input

### 🔌 MCP Server Integration
- GitHub MCP server built-in and enabled by default
- Configure custom MCP servers via settings
- Support for local and remote servers
- Enable/disable servers individually
- Integration test verifying config passthrough

### 🧠 Enhanced UX
- Show Reasoning toggle to view assistant thinking
- Tool execution shows in real-time
- Thinking indicator stays on during multi-turn responses
- Session usage tracking (tokens)

## Improvements

### Event Handling
- `assistant.turn_start` / `assistant.turn_end` tracking
- Better thinking indicator logic
- Token usage monitoring
- Improved error handling

### Testing
- MCP integration test with hello-mcp server
- End-to-end config passthrough verification
- Test coverage for all new features

### Documentation
- Updated README with MCP configuration
- Popular MCP servers documented
- File diff feature documented
- Planning mode usage documented

## Technical Details

### Architecture Changes
```
VS Code Extension (UI Layer)
       ↓
@github/copilot-sdk (v0.1.18)
       ↓ JSON-RPC
Copilot CLI (server mode)
```

### MCP Configuration Example
```json
{
  "copilotCLI.mcpServers": {
    "filesystem": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"],
      "tools": ["*"],
      "enabled": true
    }
  }
}
```

### File Diff Storage
- Uses `context.globalStorageUri` for temp files
- Automatic cleanup after viewing diff
- Full cleanup on session stop
- Memory footprint: ~100 bytes per snapshot

## Breaking Changes

None - v2.0 is backward compatible with v1.0 configurations.

## Migration Guide

All v1.0 settings work in v2.0:
- `copilotCLI.yolo` - Works as before
- `copilotCLI.model` - All 14 models supported
- `copilotCLI.allowTools` / `denyTools` - Works as before
- `copilotCLI.allowUrls` / `denyUrls` - Works as before

New settings are optional:
- `copilotCLI.mcpServers` - Optional MCP configuration

## Known Issues

None currently identified.

## Future Enhancements

See `planning/backlog/mcp-server-management-ui.md`:
- Visual MCP server management UI
- Server templates and presets
- Browse MCP Registry in-app
- Server status and diagnostics

## Contributors

- Extension development and testing
- SDK integration research
- MCP implementation and testing

## Links

- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
- [MCP Registry](https://registry.modelcontextprotocol.io/)
- [MCP Servers Repository](https://github.com/modelcontextprotocol/servers)
