# Phase 5: MCP Integration Preparation

## Status
⏸️ Not Started

## Goal
Finalize architecture to support MCP (Model Context Protocol) UI and multi-protocol operations

## Context
With the refactored architecture in place (services backend, components frontend, typed RPC), we can now cleanly integrate MCP support.

MCP allows the extension to:
- Connect to external MCP servers
- Browse resources from MCP servers (files, data sources)
- Invoke tools provided by MCP servers
- Present MCP capabilities alongside Copilot SDK

This phase implements the MCP service layer and UI components to support this workflow.

## Tasks

### MCP Protocol Research
- [ ] Study MCP protocol specification
- [ ] Identify MCP message types
- [ ] Design MCP client architecture
- [ ] Plan MCP server discovery mechanism

### Backend Service
- [ ] Implement `McpService.ts` (stub created in Phase 3)
- [ ] Add MCP server connection management
- [ ] Add MCP resource discovery
- [ ] Add MCP tool invocation
- [ ] Add MCP server lifecycle management

### Message Types
- [ ] Add MCP message types to `shared/messages.ts`
- [ ] Define MCP resource models in `shared/models.ts`
- [ ] Update RPC layer for MCP messages

### UI Components
- [ ] Create `McpServerList/` component - show connected servers
- [ ] Create `McpResourceBrowser/` component - browse MCP resources
- [ ] Create `McpToolPalette/` component - available MCP tools
- [ ] Create `McpConfiguration/` component - server settings

### Integration
- [ ] Integrate MCP with chat workflow
- [ ] Add UI to toggle between Copilot SDK and MCP modes
- [ ] Add visual indicators for MCP operations
- [ ] Test with sample MCP servers

## Technical Details

### MCP Service

```typescript
// src/extension/services/McpService.ts

export interface IMcpService {
  // Server lifecycle
  connectToServer(config: McpServerConfig): Promise<void>;
  disconnectFromServer(serverId: string): Promise<void>;
  listConnectedServers(): McpServer[];
  
  // Resource discovery
  listResources(serverId: string): Promise<McpResource[]>;
  getResource(serverId: string, resourceId: string): Promise<ResourceContent>;
  
  // Tool invocation
  listTools(serverId: string): Promise<McpTool[]>;
  invokeTool(serverId: string, toolId: string, args: any): Promise<any>;
  
  // Server management
  discoverServers(): Promise<McpServerInfo[]>;
  saveServerConfig(config: McpServerConfig): Promise<void>;
  loadServerConfigs(): Promise<McpServerConfig[]>;
}

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpServer {
  id: string;
  config: McpServerConfig;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  capabilities: McpCapabilities;
}

export interface McpResource {
  id: string;
  serverId: string;
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}

export interface McpTool {
  id: string;
  serverId: string;
  name: string;
  description?: string;
  inputSchema: any; // JSON Schema
}
```

### MCP Protocol Messages

```typescript
// src/shared/messages.ts (additions)

// Webview → Extension
export interface ConnectMcpServerPayload {
  type: 'connectMcpServer';
  config: McpServerConfig;
}

export interface ListMcpResourcesPayload {
  type: 'listMcpResources';
  serverId: string;
}

export interface InvokeMcpToolPayload {
  type: 'invokeMcpTool';
  serverId: string;
  toolId: string;
  args: any;
}

// Extension → Webview
export interface McpServerConnectedPayload {
  type: 'mcpServerConnected';
  server: McpServer;
}

export interface McpResourcesListedPayload {
  type: 'mcpResourcesListed';
  serverId: string;
  resources: McpResource[];
}

export interface McpToolInvokedPayload {
  type: 'mcpToolInvoked';
  result: any;
}
```

### MCP UI Components

#### McpServerList Component

```javascript
// src/webview/app/components/McpServerList/McpServerList.js

import { appState } from '../../state/AppState.js';
import { rpcClient } from '../../rpc/WebviewRpcClient.js';

export function createMcpServerList(container) {
  const serverListDiv = document.createElement('div');
  serverListDiv.className = 'mcp-server-list';

  function render() {
    const servers = appState.get('mcpServers') || [];
    
    serverListDiv.innerHTML = `
      <h3>MCP Servers</h3>
      <div class="server-list">
        ${servers.map(server => `
          <div class="server-item ${server.status}">
            <span class="server-name">${server.config.name}</span>
            <span class="server-status">${server.status}</span>
            <button class="disconnect-btn" data-server-id="${server.id}">
              Disconnect
            </button>
          </div>
        `).join('')}
      </div>
      <button id="add-server-btn">Add Server</button>
    `;

    // Add event listeners
    serverListDiv.querySelectorAll('.disconnect-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const serverId = e.target.dataset.serverId;
        rpcClient.disconnectMcpServer(serverId);
      });
    });

    serverListDiv.querySelector('#add-server-btn').addEventListener('click', () => {
      // Show server configuration dialog
      showMcpConfigDialog();
    });
  }

  appState.on('mcpServers', render);
  render();

  container.appendChild(serverListDiv);

  return {
    destroy() {
      appState.off('mcpServers', render);
      container.removeChild(serverListDiv);
    }
  };
}
```

#### McpResourceBrowser Component

```javascript
// src/webview/app/components/McpResourceBrowser/McpResourceBrowser.js

export function createMcpResourceBrowser(container) {
  const browserDiv = document.createElement('div');
  browserDiv.className = 'mcp-resource-browser';

  function render() {
    const servers = appState.get('mcpServers') || [];
    const selectedServerId = appState.get('selectedMcpServerId');

    browserDiv.innerHTML = `
      <h3>MCP Resources</h3>
      <select id="server-selector">
        <option value="">Select a server...</option>
        ${servers.map(s => `
          <option value="${s.id}" ${s.id === selectedServerId ? 'selected' : ''}>
            ${s.config.name}
          </option>
        `).join('')}
      </select>
      <div id="resource-list">
        ${selectedServerId ? renderResources(selectedServerId) : '<p>Select a server to view resources</p>'}
      </div>
    `;

    browserDiv.querySelector('#server-selector').addEventListener('change', (e) => {
      const serverId = e.target.value;
      appState.set('selectedMcpServerId', serverId);
      if (serverId) {
        rpcClient.listMcpResources(serverId);
      }
    });
  }

  function renderResources(serverId) {
    const resources = appState.get('mcpResources')[serverId] || [];
    return `
      <ul class="resource-list">
        ${resources.map(r => `
          <li class="resource-item" data-resource-id="${r.id}">
            <span class="resource-name">${r.name}</span>
            <span class="resource-uri">${r.uri}</span>
          </li>
        `).join('')}
      </ul>
    `;
  }

  appState.on('mcpServers', render);
  appState.on('selectedMcpServerId', render);
  appState.on('mcpResources', render);

  render();
  container.appendChild(browserDiv);

  return {
    destroy() {
      appState.off('mcpServers', render);
      appState.off('selectedMcpServerId', render);
      appState.off('mcpResources', render);
      container.removeChild(browserDiv);
    }
  };
}
```

### Integration with Chat Workflow

The chat interface should support both Copilot SDK and MCP modes:

```javascript
// In InputArea component

const modeSelector = document.createElement('select');
modeSelector.id = 'agent-mode-selector';
modeSelector.innerHTML = `
  <option value="copilot">Copilot SDK</option>
  <option value="mcp">MCP Server</option>
`;

modeSelector.addEventListener('change', (e) => {
  appState.set('agentMode', e.target.value);
  
  // Show/hide relevant UI elements
  if (e.target.value === 'mcp') {
    // Show MCP server selector, tool palette, etc.
  } else {
    // Show standard Copilot SDK interface
  }
});
```

### MCP Server Configuration UI

```javascript
// src/webview/app/components/McpConfiguration/McpConfiguration.js

export function showMcpConfigDialog() {
  const dialog = document.createElement('div');
  dialog.className = 'mcp-config-dialog';
  
  dialog.innerHTML = `
    <div class="dialog-overlay">
      <div class="dialog-content">
        <h2>Add MCP Server</h2>
        <form id="mcp-server-form">
          <label>
            Server Name:
            <input type="text" name="name" required />
          </label>
          <label>
            Command:
            <input type="text" name="command" required placeholder="node" />
          </label>
          <label>
            Arguments:
            <input type="text" name="args" placeholder="server.js --port 3000" />
          </label>
          <label>
            Environment Variables (JSON):
            <textarea name="env" placeholder='{"API_KEY": "..."}'></textarea>
          </label>
          <div class="dialog-actions">
            <button type="submit">Connect</button>
            <button type="button" id="cancel-btn">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  dialog.querySelector('#mcp-server-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    
    const config = {
      id: Date.now().toString(), // Generate ID
      name: formData.get('name'),
      command: formData.get('command'),
      args: formData.get('args').split(' ').filter(a => a),
      env: formData.get('env') ? JSON.parse(formData.get('env')) : undefined,
    };

    rpcClient.connectMcpServer(config);
    document.body.removeChild(dialog);
  });

  dialog.querySelector('#cancel-btn').addEventListener('click', () => {
    document.body.removeChild(dialog);
  });
}
```

## Non-Goals
- ❌ Do NOT implement full MCP server (we're the client)
- ❌ Do NOT support all MCP features in first iteration (start simple)
- ❌ Do NOT change existing Copilot SDK functionality

## Validation Checklist

### MCP Service
- [ ] Can connect to MCP servers
- [ ] Can disconnect from MCP servers
- [ ] Can list resources from servers
- [ ] Can invoke tools on servers
- [ ] Error handling for connection failures
- [ ] Server configuration persistence

### UI Components
- [ ] MCP server list displays correctly
- [ ] Can add/remove MCP servers via UI
- [ ] Resource browser shows server resources
- [ ] Tool palette shows available tools
- [ ] Clear indication of MCP vs SDK mode
- [ ] No UI conflicts with existing features

### Integration
- [ ] MCP and Copilot SDK can coexist
- [ ] Can switch between MCP and SDK modes
- [ ] Chat messages clearly show which mode was used
- [ ] Tool invocations work in both modes

### Testing
- [ ] Unit tests for MCP service
- [ ] Integration tests with sample MCP servers
- [ ] UI tests for MCP components
- [ ] End-to-end workflow tests

## Dependencies
- Requires Phases 1-4 to be complete (architecture must be in place)
- Requires MCP protocol specification/library
- Requires sample MCP servers for testing

## Risks & Mitigations

**Risk**: MCP protocol is complex or unstable
**Mitigation**: Start with basic features, use official MCP libraries if available

**Risk**: MCP server connection issues
**Mitigation**: Robust error handling, clear status indicators

**Risk**: UI becomes cluttered with MCP features
**Mitigation**: Use tabs/panels to organize, make MCP optional/collapsible

**Risk**: Performance issues with multiple MCP servers
**Mitigation**: Lazy loading, connection pooling, resource limits

## Notes
- This is the first "new feature" phase (all previous were refactors)
- Start with minimal MCP support, iterate based on feedback
- MCP is an optional feature - shouldn't interfere with SDK workflow
- Consider making MCP a separate view/panel if UI gets complex

## Success Criteria
✅ MCP service implemented and tested
✅ Can connect to and manage MCP servers
✅ Can browse resources from MCP servers
✅ Can invoke tools from MCP servers
✅ Clean UI for MCP operations
✅ MCP and Copilot SDK coexist peacefully
✅ Clear documentation for MCP setup
✅ At least one working MCP server integration demo
