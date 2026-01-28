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
- **Grouped Tools**: All tool executions group into a collapsible container
  - Tools stay together until user sends message or assistant responds
  - Prevents tool spam from scrolling prompts off screen
- **Fixed Height with Overflow**: 
  - Shows first 2-3 tools by default (200px max height)
  - "Expand (X more)" link appears when tools overflow
  - Click to expand → shows all tools, dynamically grows as new tools arrive
  - "Contract" link to collapse back
- **Smart Grouping Logic**:
  - User sends message → closes current tool group, starts fresh
  - Assistant responds → closes current tool group, starts fresh
  - Tools intersperse naturally between assistant messages

#### Stop Button
- **New**: Send button transforms to Stop button while assistant is thinking
- Click Stop to abort current generation (calls `session.abort()`)
- Red styling makes Stop button visually distinct
- Enter key still works to queue messages while thinking
- Session remains active after stopping

### Bug Fixes

#### Session Expiration Handling
- **Fixed**: Automatic recovery when session expires after extended inactivity
- When you leave the window open for hours and return, the extension now:
  - Detects the expired session automatically
  - Creates a new session seamlessly
  - Shows a clear visual separator in the chat
  - Preserves old conversation history above the separator
- No more "session not found" errors - just continue working

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
- Session expiration detection checks for "session not found" errors
- Automatic fallback to creating new session on resume failure
- Visual separator preserves conversation context while marking session boundary

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
- [x] Session expiration recovery creates new session automatically
- [x] Visual separator shows between expired and new session
- [x] Old conversation history preserved above separator
- [x] Session.idle timeout errors suppressed
- [x] Long-running commands complete without error popup
