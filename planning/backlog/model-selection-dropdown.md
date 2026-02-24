# Model Selection Dropdown UI - Feature Backlog

**Target Version**: v3.2.0 or v4.0.0  
**Priority**: Medium  
**Status**: Backlog (Not Started)  
**Related**: Phase 5 `/model` command (passthrough fallback)

## Problem Statement

Users cannot change the AI model mid-conversation in the VS Code extension. The current workflow requires:
1. Closing the session
2. Reconfiguring settings
3. Starting a new session
4. Losing conversation context

**User Pain Points**:
- Want to try different models for different tasks (e.g., fast model for simple questions, premium model for complex refactoring)
- Can't experiment with model capabilities without losing context
- No visibility into which model is currently active
- No awareness of premium request multipliers (costs 0.5x to 3x per message)

## Available Models (14 Total)

### Claude Family (Anthropic)
- **claude-sonnet-4.5** - Standard tier (1.0x multiplier) ✅ Default
- **claude-haiku-4.5** - Fast/cheap tier (0.5x multiplier)
- **claude-opus-4.6** - Premium tier (3.0x multiplier)
- **claude-opus-4.6-fast** - Premium tier, fast mode (2.5x multiplier)
- **claude-opus-4.5** - Premium tier (2.5x multiplier)
- **claude-sonnet-4** - Standard tier (1.0x multiplier)

### GPT Family (OpenAI)
- **gpt-5.3-codex** - Standard tier (1.0x multiplier)
- **gpt-5.2-codex** - Standard tier (1.0x multiplier)
- **gpt-5.2** - Standard tier (1.0x multiplier)
- **gpt-5.1-codex-max** - Standard tier (1.0x multiplier)
- **gpt-5.1-codex** - Standard tier (1.0x multiplier)
- **gpt-5.1** - Standard tier (1.0x multiplier)
- **gpt-5** - Standard tier (1.0x multiplier)
- **gpt-5.1-codex-mini** - Fast/cheap tier (0.5x multiplier)
- **gpt-5-mini** - Fast/cheap tier (0.5x multiplier)
- **gpt-4.1** - Fast/cheap tier (0.5x multiplier)

### Gemini Family (Google)
- **gemini-3-pro-preview** - Standard tier (1.0x multiplier)

## Proposed Design: Dropdown Above Input Area

**Location**: Right above "show reasoning" and "enter plan mode" icon.

```
┌─────────────────────────────────────────┐
│  [Message history scrolls here]         │
│                                          │
│  User: Can you help me?                  │
│  Assistant: Sure! What do you need?      │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐  ← NEW COMPONENT
│  Model: claude-sonnet-4.5 ▼ (1.0x)     │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│  Type a message or /command...          │
│  [Send]                                  │
└─────────────────────────────────────────┘
```

### Dropdown Content (Grouped by Family)

```
┌─────────────────────────────────────────────────┐
│ 🎯 Standard Models (1.0x requests)               │
├─────────────────────────────────────────────────┤
│ ✓ claude-sonnet-4.5 (Default)                   │
│   claude-sonnet-4                                │
│   gpt-5.3-codex                                  │
│   gpt-5.2-codex                                  │
│   gpt-5.2                                        │
│   gpt-5.1-codex-max                              │
│   gpt-5.1-codex                                  │
│   gpt-5.1                                        │
│   gpt-5                                          │
│   gemini-3-pro-preview                           │
├─────────────────────────────────────────────────┤
│ ⚡ Fast Models (0.5x requests)                   │
├─────────────────────────────────────────────────┤
│   claude-haiku-4.5                               │
│   gpt-5.1-codex-mini                             │
│   gpt-5-mini                                     │
│   gpt-4.1                                        │
├─────────────────────────────────────────────────┤
│ 💎 Premium Models (2.5x - 3.0x requests)         │
├─────────────────────────────────────────────────┤
│   claude-opus-4.6 (3.0x)                         │
│   claude-opus-4.6-fast (2.5x)                    │
│   claude-opus-4.5 (2.5x)                         │
└─────────────────────────────────────────────────┘
```

### Visual Design Details

**Collapsed State**:
- Single line bar between messages and input
- Shows current model name + multiplier
- Dropdown arrow indicator
- Subtle border, matches VS Code theme
- Example: `Model: claude-sonnet-4.5 ▼ (1.0x)`

**Expanded State**:
- 3 groups with headers (Standard, Fast, Premium)
- Current model has checkmark ✓
- Each model shows name + multiplier
- Group headers have icons (🎯 ⚡ 💎)
- Max height: 300px, scrollable if needed

**Styling**:
- Background: `--vscode-dropdown-background`
- Border: `--vscode-dropdown-border`
- Text: `--vscode-dropdown-foreground`
- Hover: `--vscode-list-hoverBackground`
- Selected: `--vscode-list-activeSelectionBackground`

## Technical Approach

### Investigation Needed: SDK Support

**Key Questions**:
1. Can the Copilot SDK switch models mid-session?
2. Does conversation context/history transfer to the new model?
3. Is there an API method like `session.setModel(modelName)`?
4. Do we need to create a new session with the new model?

**SDK Research Tasks**:
- [ ] Check `@github/copilot-sdk` documentation for model switching
- [ ] Review `CopilotSession` API methods
- [ ] Test: Create session with one model, switch to another
- [ ] Verify: Context preservation after model switch
- [ ] Investigate: Token quota tracking per model

**Fallback Strategy**:
If SDK doesn't support mid-session model switching:
- Treat `/model` as CLI passthrough command
- Open terminal with `copilot --resume <id>`
- User selects model in CLI
- Terminal shows full model selection UX
- Context preserved via `--resume` flag

### Implementation Phases

#### Phase 1: UI Component (ModelSelector.js)
**File**: `src/webview/app/components/ModelSelector/ModelSelector.js`

**Responsibilities**:
- Render model dropdown between messages and input
- Display current model with multiplier
- Group models by tier (Standard, Fast, Premium)
- Handle dropdown expand/collapse
- Emit `modelSelected` event on user selection

**API**:
```javascript
class ModelSelector {
  constructor(container, eventBus, initialModel = 'claude-sonnet-4.5') {
    this.eventBus = eventBus;
    this.currentModel = initialModel;
    this.models = this.loadModelData();
  }
  
  render() {
    // Render collapsed dropdown bar
  }
  
  expand() {
    // Show model list grouped by tier
  }
  
  selectModel(modelName) {
    // Update UI, emit event
    this.eventBus.emit('modelSelected', { model: modelName });
  }
}
```

#### Phase 2: Model Data Source

**Option A: Hardcoded List** (Simple, works offline)
```javascript
const MODELS = {
  standard: [
    { name: 'claude-sonnet-4.5', multiplier: 1.0, default: true },
    { name: 'claude-sonnet-4', multiplier: 1.0 },
    // ... 10 total
  ],
  fast: [
    { name: 'claude-haiku-4.5', multiplier: 0.5 },
    // ... 4 total
  ],
  premium: [
    { name: 'claude-opus-4.6', multiplier: 3.0 },
    // ... 3 total
  ]
};
```

**Option B: SDK Query** (Dynamic, always current)
- Check if SDK exposes `client.listAvailableModels()`
- Parse model capabilities from SDK response
- Fallback to hardcoded list if SDK doesn't provide

**Recommendation**: Start with hardcoded list (Option A), add SDK query later if available

#### Phase 3: Model Switching Backend

**RPC Message Flow**:
1. User selects model in dropdown → `modelSelected` event
2. Frontend sends RPC: `{ type: 'switchModel', model: 'claude-opus-4.6' }`
3. Backend receives in `ExtensionRpcRouter.ts`
4. Backend calls SDK (if supported): `session.setModel(model)` OR creates new session
5. Backend confirms: `{ type: 'modelSwitched', model: 'claude-opus-4.6', success: true }`
6. Frontend updates dropdown display

**Backend Service**: `ModelSwitchingService.ts`
```typescript
class ModelSwitchingService {
  async switchModel(newModel: string): Promise<boolean> {
    // Try SDK native switching
    if (session.supportsModelSwitching) {
      await session.setModel(newModel);
      return true;
    }
    
    // Fallback: Create new session with new model
    const oldHistory = await session.exportHistory();
    const newSession = await client.createSession({ model: newModel });
    await newSession.importHistory(oldHistory);
    return true;
  }
}
```

#### Phase 4: Webview Feedback

**Confirmation Banner**:
```
┌─────────────────────────────────────────┐
│ ✓ Model switched to claude-opus-4.6     │
│   Next message will use this model.      │
│   (Costs 3.0x requests)                  │
└─────────────────────────────────────────┘
```

**Error Banner** (if switch fails):
```
┌─────────────────────────────────────────┐
│ ✗ Failed to switch model                │
│   Continuing with claude-sonnet-4.5      │
└─────────────────────────────────────────┘
```

#### Phase 5: Persistence (BackendState)

**Track in BackendState**:
```typescript
class BackendState {
  private currentModel: string = 'claude-sonnet-4.5';
  
  setModel(model: string): void {
    this.currentModel = model;
    this.logger.info(`[Model] Switched to ${model}`);
  }
  
  getCurrentModel(): string {
    return this.currentModel;
  }
}
```

**Restore on Session Resume**:
- When resuming session, read model from session metadata
- If session has no model info, use default (claude-sonnet-4.5)
- Update dropdown to reflect current model

#### Phase 6: Testing

**Unit Tests**:
- `tests/unit/webview/components/model-selector.test.js`
  - Renders collapsed state correctly
  - Groups models by tier
  - Emits event on selection
  - Shows current model with checkmark

**Integration Tests**:
- `tests/integration/model-switching.test.js`
  - User selects model → RPC sent → Backend confirms
  - Model persists across webview reload
  - Error handling when SDK fails

**E2E Tests (Manual)**:
- [ ] Open chat, verify default model shown
- [ ] Click dropdown, verify 14 models grouped by tier
- [ ] Select fast model (haiku), send message, verify confirmation
- [ ] Reload window, verify model persists
- [ ] Select premium model (opus), verify 3.0x warning
- [ ] Switch back to standard model, verify confirmation

## Alternative Designs Considered

### ❌ Inline Dropdown in Input Box
**Design**: Model selector inside the input box (like emoji picker)
```
┌─────────────────────────────────────────┐
│ [Model ▼] Type a message...        [Send]│
└─────────────────────────────────────────┘
```

**Pros**: Compact, always visible
**Cons**: 
- Cramped UI, conflicts with input area
- Less space for model name display
- Doesn't show multiplier clearly
- Violates input box single-purpose design

**Verdict**: ❌ Rejected - Too cramped

---

### ❌ Settings Modal (Click to Open)
**Design**: Gear icon opens modal with model selection
```
┌─────────────────────────────────────────┐
│ Type a message...               [⚙️] [Send]│
└─────────────────────────────────────────┘

(Click ⚙️ → Modal opens)
```

**Pros**: Clean main UI, room for detailed model info
**Cons**:
- Extra click to change model
- Modal hides conversation
- Poor discoverability
- Slower workflow for frequent switching

**Verdict**: ❌ Rejected - Not accessible enough

---

### ❌ Slash Command Only (`/model <name>`)
**Design**: No UI, type `/model claude-opus-4.6` in chat

**Pros**: Zero UI complexity, simple to implement
**Cons**:
- Poor discoverability (users don't know command exists)
- Hard to remember 14 model names
- No visibility into current model
- No autocomplete for model names
- Can't see multipliers

**Verdict**: ❌ Rejected - Poor UX for primary feature

---

### ✅ Dropdown Above Input (CHOSEN)
**Design**: Persistent bar between messages and input

**Pros**:
- ✅ Always visible (current model shown)
- ✅ One click to change model
- ✅ Room to show multipliers
- ✅ Grouped by tier (helps users choose)
- ✅ Doesn't hide conversation
- ✅ Matches VS Code design patterns
- ✅ Accessible (keyboard navigation)

**Cons**:
- Takes vertical space (~30px)
- Adds UI complexity

**Verdict**: ✅ **CHOSEN** - Best balance of usability and visibility

## Success Criteria

### Functional Requirements
- [ ] User sees current model above input area
- [ ] Dropdown shows all 14 models grouped by tier
- [ ] Selecting a model sends RPC to backend
- [ ] Backend switches model (SDK or fallback method)
- [ ] Confirmation banner shows model switch success
- [ ] Next message uses the new model
- [ ] Context preserved after model switch
- [ ] Model selection persists across webview reloads

### Visual Requirements
- [ ] Dropdown matches VS Code theme (dark/light mode)
- [ ] Current model has checkmark indicator
- [ ] Multipliers shown for all models
- [ ] Group headers clearly separate tiers
- [ ] Hover states for better UX
- [ ] Smooth expand/collapse animation

### Performance Requirements
- [ ] Dropdown renders in < 50ms
- [ ] Model switch completes in < 2 seconds
- [ ] No lag when typing in input area
- [ ] No memory leaks from event listeners

### Accessibility Requirements
- [ ] Keyboard navigation (arrow keys, Enter)
- [ ] Screen reader announces current model
- [ ] Focus management (Escape to close)
- [ ] ARIA labels for dropdown elements

## Risk Assessment

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| SDK doesn't support model switching | High | Medium | Fallback to CLI passthrough (`/model` terminal) |
| Context lost on model switch | High | Low | Export/import history if creating new session |
| Performance with 14 models | Low | Low | Virtualized list if dropdown lags |
| User confusion about multipliers | Medium | Medium | Clear UI labels + help tooltip |
| Model list becomes outdated | Medium | High | Add "Refresh models" button, sync with SDK |

## Dependencies

**SDK Dependencies** (To Be Investigated):
- `@github/copilot-sdk` - Model switching API (if exists)
- `CopilotSession.setModel()` or equivalent
- `CopilotClient.listAvailableModels()` or equivalent

**VS Code Dependencies**:
- Webview API for UI rendering
- EventBus for component communication

**Internal Dependencies**:
- `BackendState` - Store current model
- `ExtensionRpcRouter` - Handle `switchModel` RPC
- `MCPConfigurationService` - Model validation (if needed)

## Documentation Updates

### README.md - Add Section
```markdown
### Model Selection

Change the AI model mid-conversation using the model dropdown above the input area.

**Available Models**:
- **Standard** (1.0x requests): claude-sonnet-4.5 (default), GPT-5 family, Gemini
- **Fast** (0.5x requests): claude-haiku-4.5, GPT-5-mini, GPT-4.1
- **Premium** (2.5x-3.0x requests): claude-opus-4.6, claude-opus-4.5

**How to Switch**:
1. Click the model dropdown above the input box
2. Select your desired model
3. Confirmation message shows the switch was successful
4. Next message uses the new model

**Request Multipliers**: Premium models cost more requests per message. A 3.0x model uses 3 requests for every message you send.
```

### CHANGELOG.md
```markdown
## [3.2.0] - 2026-XX-XX (or 4.0.0)

### ✨ New Features
- **Model Selection Dropdown**: Change AI models mid-conversation with a dropdown above the input area. Choose from 14 models across 3 tiers (Standard, Fast, Premium) with clear request multiplier indicators.
```

## Timeline Estimate

**Total Effort**: 16-20 hours

**Breakdown**:
- SDK Investigation: 2-3 hours
- UI Component (ModelSelector.js): 4-5 hours
- Backend Service (ModelSwitchingService.ts): 3-4 hours
- RPC Wiring: 1-2 hours
- Persistence (BackendState): 1 hour
- Testing (unit + integration): 3-4 hours
- Documentation: 1 hour
- Manual testing + polish: 2-3 hours

**Phases**:
- Phase 1: SDK Investigation (sprint 1)
- Phase 2: UI Prototype (sprint 1-2)
- Phase 3: Backend Integration (sprint 2)
- Phase 4-6: Testing & Polish (sprint 3)

## Related Issues

- Phase 5, Task 1.6: `/model` command (CLI passthrough fallback)
- BackendState expansion (current model tracking)
- MCP model validation (ensure model supports MCP tools)

## Open Questions

1. **SDK Model Switching**: Does `@github/copilot-sdk` support changing models mid-session?
2. **Context Preservation**: If we create a new session, how do we transfer conversation history?
3. **Token Quotas**: Do quotas reset when switching models? How do we track usage per model?
4. **Model Capabilities**: Do all models support the same tools? (e.g., MCP servers, custom tools)
5. **Default Model**: Should we read from VS Code settings or always default to claude-sonnet-4.5?
6. **Enterprise Restrictions**: Can admins restrict available models? How do we handle this?

## Next Steps

**Before Starting Implementation**:
1. Research SDK documentation for model switching APIs
2. Test model switching in native Copilot CLI
3. Verify context preservation works
4. Confirm token quota behavior
5. Design data structures for model metadata

**When Ready to Implement**:
1. Create feature branch: `feature/model-selection-dropdown`
2. Start with Phase 1 (UI Component) as standalone prototype
3. Integrate backend once SDK investigation complete
4. Add comprehensive tests
5. Document thoroughly
6. Request code review before merge

---

**Status**: 📋 Backlog (Documented, Not Started)  
**Last Updated**: 2026-02-14
