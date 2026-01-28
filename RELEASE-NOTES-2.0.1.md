# Release Notes - v2.0.1

## 🎯 Usage Tracking & Tool Grouping

### New Features

#### Real-Time Usage Statistics
- **Window Usage**: Context window percentage (e.g., "Window: 38%")
  - Shows how much of the 128k token context window is used
  - Tooltip displays exact token counts
- **Tokens Used**: Session token count in compact format (k/m/b)
  - e.g., "Used: 49k" = 49,000 tokens
  - Tooltip shows full number with commas
- **Remaining Quota**: Request quota percentage from your Copilot account
  - e.g., "Remaining: 76%"
  - Updates after each LLM API call
  - Shows "--" until first assistant.usage event

Display format: `Window: 38% | Used: 49k | Remaining: 76%`

All three metrics appear in the status bar, left of "Show Reasoning | Plan Mode | View Plan"

#### Tool Grouping with Expand/Collapse
- **Grouped Tools**: All tool executions now group into a single collapsible container
  - Tools stay together until the user sends a new message
  - Prevents tool spam from scrolling user prompts off screen
- **Fixed Height with Overflow**: 
  - Shows first 2-3 tools by default (200px max height)
  - "Expand (X more)" link appears when tools overflow
  - Click to expand → shows all tools, dynamically grows as new tools arrive
  - "Contract" link to collapse back
- **Smart Grouping Logic**:
  - User sends message → closes current tool group
  - Assistant responds → tools continue in same group
  - Next user message → creates fresh tool group

### Bug Fixes

#### Session.idle Timeout Errors
- **Fixed**: Suppressed confusing `Timeout after 60000ms waiting for session.idle` errors
- Long-running bash commands (like `code --install-extension`) now complete silently
- Timeout errors are logged to output channel but not shown to users
- Only real errors are surfaced to the UI

### Technical Details

**Events Used**:
- `session.usage_info`: Provides token count and limit for Window/Used metrics
- `assistant.usage.quotaSnapshots`: Provides request quota percentage for Remaining metric

**Implementation**:
- Tool grouping uses dynamic DOM manipulation with event delegation
- Expand/collapse state persists until user sends next message
- Fixed height uses CSS max-height with overflow:hidden + toggle

### Known Issues
- Remaining quota shows "--" until first LLM API call completes (expected behavior)
- Tool group expand state doesn't persist across window reloads (by design)

---

## Migration from v2.0.0
No breaking changes. Update and reload - everything works as before with new features enabled.

## Testing Checklist
- [x] Usage stats update in real-time during session
- [x] Tool grouping works with multiple sequential tools
- [x] Expand/collapse toggle appears when >3 tools
- [x] User message closes tool group and starts fresh
- [x] Session.idle timeout errors suppressed
- [x] Long-running commands complete without error popup
