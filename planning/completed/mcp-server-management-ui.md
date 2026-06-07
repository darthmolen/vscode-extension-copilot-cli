# MCP Server Management UI

**Status**: ✅ Core delivered in v3.9.0  
**Priority**: Medium  
**Estimated Effort**: 3-5 days  
**Dependencies**: V2.0 MCP config passthrough

## Overview

Build a visual UI for managing MCP (Model Context Protocol) servers in VS Code, making it easy for users to discover, configure, and manage MCP servers without editing JSON settings.

## ✅ Delivered in v3.9.0

The core management UI shipped in the existing `/mcp` slide-in panel:

- **Visibility across every source** — the panel lists servers with a source badge: `user` (`copilotCLI.mcpServers`), `managed` (bundled), `imported` (VS Code's native `.vscode/mcp.json` + user `mcp.json`), and `copilot` (Copilot CLI's own config, read via `mcp.config.list`). Read-only sources show a 🔒.
- **Import VS Code's native servers** into sessions, translated to SDK shape; gated by `copilotCLI.importVSCodeMcpServers`.
- **Add / edit / remove / enable-disable** from an inline form (args one-per-line or comma-separated).
- **Validation** of name/type/required fields, enforced both in the form and the extension handler.
- **Status indicators** (🟢 connected · 🟡 configured · 🔴 failed · ⏳ connecting · ⚪ unknown).

**Boundary:** writes only ever touch this extension's own `copilotCLI.mcpServers`; VS Code's and Copilot's configs are never mutated (Copilot/imported/managed rows are read-only).

**Deferred (future enhancements, not implemented):** server templates (Feature 2), "Test connection" button, the diagnostics/logs panel (Feature 4), and MCP Registry browse/install (Feature 5).

The original proposal below is retained for historical context.

## Current State (V3.0)

✅ **What Works**:
- MCP servers configurable via `copilotCLI.mcpServers` setting
- Config passed to SDK automatically
- GitHub MCP built-in and enabled by default
- Documentation shows example configurations

❌ **What's Missing**:
- No visual UI for adding/removing servers
- Users must manually edit JSON
- No discovery of available MCP servers
- No templates for popular servers
- No validation of server configurations

## Proposed Solution

### Feature 1: MCP Server Management Panel

**Location**: VS Code sidebar panel or settings UI

**Features**:
- List all configured MCP servers with status (enabled/disabled) (completed)
- Add new server button → wizard/form
- Edit/delete existing servers
- Enable/disable toggle per server
- Test connection button
- Import from `~/.copilot/mcp-config.json` if exists

**UI Mockup**:
```
┌─ MCP SERVERS ─────────────────────┐
│ [+ Add Server] [Import from CLI]  │
├───────────────────────────────────┤
│ ✓ GitHub MCP (Built-in)           │
│   http://api.githubcopilot.com/mcp│
│   Tools: *, Status: Active        │
│   [Edit] [Disable]                │
├───────────────────────────────────┤
│ ✓ Filesystem                      │
│   npx @modelcontextprotocol/...   │
│   Tools: *, Status: Active        │
│   [Edit] [Disable] [Test]         │
├───────────────────────────────────┤
│ ○ Memory (Disabled)               │
│   python -m memory_server         │
│   [Edit] [Enable] [Remove]        │
└───────────────────────────────────┘
```

### Feature 2: Server Templates

Pre-configured templates for popular MCP servers:

**Template Categories**:
1. **File Operations**:
   - Filesystem Server
   - Git Server
   
2. **Web & APIs**:
   - Fetch Server
   - GitHub MCP Server (built-in)
   
3. **Data & Storage**:
   - Memory/Knowledge Graph
   - Database servers (future)

**Template Form**:
```
┌─ Add MCP Server from Template ────┐
│ Template: [Filesystem Server ▼]   │
│                                    │
│ Name: [filesystem            ]    │
│ Type: [local                 ]    │
│ Command: [npx               ]     │
│ Arguments:                         │
│   [-y                       ]     │
│   [@modelcontextprotocol/...  ]   │
│   [${workspaceFolder}       ]     │
│ Tools: [* (all)             ]     │
│                                    │
│ [Cancel] [Add Server]             │
└───────────────────────────────────┘
```

### Feature 3: Custom Server Configuration

**Add Custom Server Form**:
```
┌─ Add Custom MCP Server ───────────┐
│ Server Name: [              ]     │
│ Type: [○ Local  ○ HTTP  ○ SSE]   │
│                                    │
│ ─ Local Configuration ─           │
│ Command: [npx              ]      │
│ Arguments: (one per line)         │
│ ┌─────────────────────────┐       │
│ │ -y                      │       │
│ │ server-package          │       │
│ └─────────────────────────┘       │
│                                    │
│ Working Directory:                 │
│ [${workspaceFolder}        ]      │
│                                    │
│ Environment Variables:             │
│ Key: [      ] Value: [      ]     │
│ [+ Add Variable]                   │
│                                    │
│ Tools: [☑ All  ☐ Specific]        │
│ ┌─────────────────────────┐       │
│ │                         │       │
│ └─────────────────────────┘       │
│                                    │
│ [Cancel] [Test] [Add Server]      │
└───────────────────────────────────┘
```

### Feature 4: Server Status & Diagnostics

**Status Indicators**:
- 🟢 Active (server running, tools available)
- 🟡 Starting (server initializing)
- 🔴 Error (failed to start or crashed)
- ⚪ Disabled (configured but not active)

**Diagnostics Panel**:
```
┌─ Server Diagnostics: filesystem ──┐
│ Status: 🟢 Active                 │
│ PID: 12345                         │
│ Uptime: 5 minutes                  │
│ Tools Discovered: 8                │
│   - read_file                      │
│   - write_file                     │
│   - list_directory                 │
│   - ...                            │
│                                    │
│ Recent Logs:                       │
│ ┌─────────────────────────┐       │
│ │ [INFO] Server started   │       │
│ │ [INFO] Discovered 8 tool│       │
│ │ [DEBUG] Tool called: rea│       │
│ └─────────────────────────┘       │
│                                    │
│ [View Full Logs] [Restart]        │
└───────────────────────────────────┘
```

### Feature 5: MCP Registry Integration

**Browse MCP Registry**:
- Show servers from https://registry.modelcontextprotocol.io/
- Filter by category
- One-click install popular servers
- Auto-configure with sensible defaults

## Technical Implementation

### 1. Webview Panel for UI

```typescript
// src/mcpServerPanel.ts
export class MCPServerPanelProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(webviewView: vscode.WebviewView) {
    // Render MCP server list
    // Handle add/edit/delete/toggle events
  }
}
```

### 2. Configuration Management

```typescript
// src/mcpConfigManager.ts
export class MCPConfigManager {
  getServers(): Record<string, MCPServerConfig>;
  addServer(name: string, config: MCPServerConfig): void;
  updateServer(name: string, config: MCPServerConfig): void;
  deleteServer(name: string): void;
  toggleServer(name: string, enabled: boolean): void;
  importFromCLI(): void; // Import from ~/.copilot/mcp-config.json
}
```

### 3. Server Templates

```typescript
// src/mcpTemplates.ts
export const MCP_TEMPLATES: Record<string, MCPServerTemplate> = {
  filesystem: {
    name: "Filesystem Server",
    description: "Secure file operations with access controls",
    config: {
      type: "local",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"],
      tools: ["*"]
    }
  },
  // ... more templates
};
```

### 4. Validation & Testing

```typescript
// Validate MCP server config before saving
async function validateMCPServer(config: MCPServerConfig): Promise<ValidationResult> {
  // Check if command exists
  // Verify URL is reachable (for remote servers)
  // Test tool discovery
}

// Test server connection
async function testMCPServer(config: MCPServerConfig): Promise<TestResult> {
  // Start server
  // Attempt to list tools
  // Return diagnostics
}
```

## User Flow Examples

### Example 1: Add Filesystem Server
1. Click "Add Server" button
2. Select "Filesystem Server" template
3. Template pre-fills command and args
4. User edits path to allowed directory
5. Click "Test" to verify it works
6. Click "Add Server" to save
7. Server appears in list as enabled

### Example 2: Import from CLI Config
1. Click "Import from CLI" button
2. Extension reads `~/.copilot/mcp-config.json`
3. Shows preview of servers to import
4. User selects which to import
5. Servers added to VS Code settings
6. User can edit/manage via UI

### Example 3: Troubleshoot Broken Server
1. User sees 🔴 error indicator on server
2. Clicks server to expand diagnostics
3. Views error logs showing missing dependency
4. Installs missing package
5. Clicks "Restart" button
6. Server status changes to 🟢 active

## Benefits

✅ **Discoverability**: Users can browse and install popular MCP servers  
✅ **Ease of Use**: No manual JSON editing required  
✅ **Validation**: Catch configuration errors before runtime  
✅ **Diagnostics**: Quick troubleshooting of server issues  
✅ **Onboarding**: Templates make it easy to get started  

## Acceptance Criteria

- [x] UI panel shows all configured MCP servers
- [x] Can add server via custom config (templates deferred)
- [x] Can edit/delete/enable/disable servers
- [ ] Can test server connection before saving (deferred)
- [x] Can surface servers from the CLI config (read-only via `mcp.config.list`)
- [x] Server status shown with visual indicators
- [x] Form validation prevents invalid configs
- [ ] Documentation updated with UI screenshots (README/CHANGELOG updated; screenshots pending)
- [x] Unit tests (pure logic + JSDOM panel) for add/edit/remove/enable flows

## Future Enhancements

- Browse MCP Registry in-app
- Auto-update installed servers
- Server usage statistics (which tools used most)
- Recommended servers based on workspace type
- Export config to share with team
- Server marketplace/extensions

## References

- [MCP Registry](https://registry.modelcontextprotocol.io/)
- [MCP Servers Repository](https://github.com/modelcontextprotocol/servers)
- [Copilot SDK MCP Types](../research/copilot-sdk/nodejs/src/types.ts)
