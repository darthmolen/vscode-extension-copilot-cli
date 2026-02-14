# Phase 5: CLI-only Command Support

## Goal

Support CLI commands not available in the SDK (`/plugin`, `/mcp`, etc.) using terminal + in-chat refresh pattern.

## Pattern (matching login flow)

1. User triggers CLI-only command (e.g., `/mcp` or `/plugin`)
2. Extension opens integrated terminal with `gh copilot` in interactive mode
3. Chat window displays:
   - Message explaining the terminal opened for the command
   - Refresh button embedded in chat (NOT a popup)
4. User completes the action in terminal
5. User clicks refresh button in chat to reload state

## Benefits

- Gives users access to full CLI capabilities
- Non-blocking UX (terminal side-by-side with chat)
- Matches Claude Code Extension pattern
- Reuses existing login flow architecture

## Commands to Support

- `/plugin` - Plugin management
- `/mcp` - MCP server management
- Any future CLI-only commands

## Implementation Tasks

### Backend (Extension Host)

- [ ] Create `src/extension/services/CliCommandService.ts`
  - Terminal spawning logic
  - Command detection and routing
  - State refresh after terminal commands
  
- [ ] Add RPC messages to `src/shared/messages.ts`
  - `openCliCommand` - Request to open terminal for CLI command
  - `refreshAfterCli` - Refresh state after CLI action completes

### Frontend (Webview)

- [ ] Create `src/webview/app/components/Chat/CliCommandPrompt.tsx`
  - Display message about terminal being opened
  - Embedded refresh button (inline in chat, not popup)
  - Handle refresh click and RPC call
  
- [ ] Update chat message renderer to handle CLI command prompts

### Integration

- [ ] Wire up command detection in message handler
- [ ] Test with `/plugin` command
- [ ] Test with `/mcp` command
- [ ] Verify terminal opens correctly
- [ ] Verify refresh reloads relevant state

## Testing

- Manual test: Trigger `/plugin` in chat → terminal opens → refresh works
- Manual test: Trigger `/mcp` in chat → terminal opens → refresh works
- Edge case: User closes terminal before refresh → graceful handling
- Edge case: Multiple CLI commands in sequence

## Success Criteria

- [ ] CLI-only commands open integrated terminal
- [ ] In-chat refresh button appears after command
- [ ] Refresh button successfully reloads state
- [ ] UX matches Claude Code Extension pattern
- [ ] No blocking popups or modals
