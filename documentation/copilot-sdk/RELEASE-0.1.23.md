# @github/copilot-sdk v0.1.23

**Release Date**: February 6, 2026  
**Release URL**: https://github.com/github/copilot-sdk/releases/tag/v0.1.23

## Summary

**Bundling release** - Major packaging improvements for Node.js SDK with stricter Node version requirements and test infrastructure enhancements.

## Key Changes

### 🎉 New Features

- **Bundling** (PR #382) 🔥
  - SDK now ships as bundled code
  - Reduced dependency conflicts
  - Smaller package size
  - Improved loading performance
  - **BREAKING: Requires Node.js 24+**

### 🔧 Testing Improvements

- **SDK Tests on Push to Main** (PR #390)
  - Run full test suite on main branch pushes
  - Catch regressions earlier

- **Python E2E Test Reliability** (PR #391)
  - Fixed flakiness in Python E2E tests
  - Missing pytest-timeout added
  - More stable CI

- **.NET SDK Package Fix** (PR #392)
  - Ensure no auto update
  - Predictable .NET SDK behavior

## Breaking Changes

### ⚠️ Node.js Version Requirement

**Minimum Node.js version: 24.0.0**

**Why?**
- Bundling changes rely on newer Node.js APIs
- Better ESM support in Node 24+
- Security improvements in newer Node runtime

**Impact**: Cannot upgrade to this version while on Node 20.x

## Contributors

- @SteveSandersonMS - All 4 PRs (bundling, testing improvements)

## Impact on vscode-copilot-cli-extension

**Relevance**: ⚠️ **BLOCKED** - Cannot upgrade yet

### Why We Can't Use This Version

**Node 24 Requirement** - We're on Node 20.20.0

**Current Status**:
- Extension uses Node 20.20.0
- v0.1.23 requires Node 24.0.0+
- **Blocked until we upgrade Node.js**

### What We're Missing

**1. Bundling Benefits**
- Faster SDK loading
- Fewer dependency conflicts
- Smaller package size

**2. Latest Bug Fixes**
- .NET SDK auto-update fix
- Python test reliability improvements

### Path Forward

**Option A: Upgrade to Node 24**
- Node 24.13.1 is current LTS "Krypton"
- Safe to upgrade (released Feb 9, 2026)
- Would enable v0.1.23 upgrade

**Option B: Stay on 0.1.22**
- Stable on Node 20
- Has critical bug fixes (sendAndWait)
- Missing bundling improvements

### Recommendation

**Stay on 0.1.22 for now**
- Node 20 is still supported LTS
- 0.1.22 has the critical fixes we need
- Bundling is nice-to-have, not critical
- Can upgrade to Node 24 + SDK 0.1.23 in v3.0.2 or later

## Version History Context

This is the **6th patch release** in the 0.1.x series we've tracked:
- 0.1.18 - Infinite Sessions
- 0.1.19 - Documentation & MCP
- 0.1.20 - Hooks, auth options, typed events
- 0.1.21 - Reasoning effort, model caching, connect to running CLI
- **0.1.22 - Critical bug fixes (our current version)** ✅
- **0.1.23 - Bundling (blocked by Node 24)** ⛔

## Full Changelog

https://github.com/github/copilot-sdk/compare/v0.1.22...v0.1.23
