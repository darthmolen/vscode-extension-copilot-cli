# @github/copilot-sdk v0.1.18

**Release Date**: January 24, 2026  
**Release URL**: https://github.com/github/copilot-sdk/releases/tag/v0.1.18

## Summary

Major feature release introducing **Infinite Sessions** - the ability to checkpoint and resume long-running sessions without token limit constraints.

## Key Changes

### 🎉 New Features

- **Infinite Sessions** (PR #76)
  - Checkpoint mechanism for long-running sessions
  - Session state persistence and resumption
  - Breaks through token context limitations
  - Enables multi-day conversations without losing context

## Contributors

- **New Contributors**: @jmoseley (Infinite Sessions feature)

## Impact on vscode-copilot-cli-extension

**Relevance**: ✅ High - Infinite Sessions is a critical feature

- Enables users to work on complex tasks over multiple days
- Session checkpoints stored in `~/.copilot/session-state/{session-id}/checkpoints/`
- Extension already supports infinite sessions through SDK integration
- v3.0.0 of our extension leverages this feature for long-running planning/implementation work

## Full Changelog

https://github.com/github/copilot-sdk/compare/v0.1.17...v0.1.18
