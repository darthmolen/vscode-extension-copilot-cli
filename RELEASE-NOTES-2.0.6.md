# Release Notes - v2.0.6

## 🎉 What's New

### Plan Mode Auto-Context Injection
When you accept a plan, the extension now automatically injects the plan file path into the work session. This ensures the AI knows exactly where your plan is and what to implement, eliminating confusion when switching from planning to implementation.

**Before:**
```
[Accept Plan] → Back to work mode
User: "implement"
AI: *searches for old plans from other sessions*
```

**After:**
```
[Accept Plan] → Back to work mode
AI: "I have the plan at ~/.copilot/.../plan.md. Let me read it and begin implementation..."
```

### UI Improvements

**Icon-Only Planning Buttons**
- Planning buttons are now compact icons: 📝, ✅, ❌, 📋
- Prevents text overflow when resizing the window
- Tooltips show full descriptions on hover
- Aligned in a "Planning" group for better organization

**Fixed Alignment Issues**
- Planning buttons now align horizontally with other controls
- "Planning" title overlays buttons without affecting vertical position
- Metrics, Show Reasoning, and Planning controls all on same baseline

**Tool Group Improvements**
- Tool groups now default to collapsed state when overflowing
- "Expand (x more)" button correctly shows collapsed initially
- Better visual organization of multiple tool executions

## 🔧 Technical Improvements

### Plan Mode Security Enhancements
- Renamed custom tools to avoid SDK conflicts (`plan_bash_explore`, `task_agent_type_explore`, etc.)
- Implemented `availableTools` whitelist for explicit tool control
- 11 safe tools available in plan mode (5 custom + 6 SDK)
- SDK's dangerous tools (bash, create, edit, task) completely blocked

### Test Suite Expansion
- Added 3 comprehensive plan mode test suites
- 42 total tests covering all security restrictions
- Tests verify tool availability, restrictions, and workflow
- All tests passing ✅

### Documentation Organization
- Created comprehensive PLAN_MODE.md with ACE-FCA methodology
- Organized test documentation with proper references
- Moved completed planning docs to planning/completed/
- Updated README.md with all current features

## 📋 Full Changelog

### Added
- Auto-inject plan context when accepting plan
- Icon-only planning buttons with tooltips
- "Planning" group box for button organization
- PLAN_MODE.md comprehensive documentation
- Plan mode test suites (42 tests)

### Fixed
- Planning button alignment issues
- Tool group default collapse state
- View Plan button placement in Planning group
- Plan context lost when switching to work mode

### Changed
- Planning buttons from text+icon to icon-only
- Button padding optimized for icon layout (6px 8px)
- Tool names renamed for plan mode uniqueness
- Test documentation restructured and indexed

### Technical
- Implemented availableTools whitelist in plan session
- Renamed custom tools: bash→plan_bash_explore, task→task_agent_type_explore, etc.
- Added 3 test suites: safe-tools (7), restrictions (26), integration (9)
- Updated session manager with auto-context injection

## 📦 Installation

```bash
code --install-extension copilot-cli-extension-2.0.6.vsix --force
```

Or install from VS Code Marketplace (once published).

## 🔗 Resources

- **Documentation:** [README.md](./README.md)
- **Plan Mode Guide:** [PLAN_MODE.md](./PLAN_MODE.md)
- **Test Suite:** [tests/README.md](./tests/README.md)
- **Changelog:** [CHANGELOG.md](./CHANGELOG.md)

## 🙏 Acknowledgments

This release focuses on improving the ACE-FCA workflow by making plan mode more robust and user-friendly. The auto-context injection feature ensures seamless transition from planning to implementation, a critical part of the ACE-FCA methodology.

---

**Version:** 2.0.6  
**Release Date:** February 2026  
**Previous Version:** 2.0.5
