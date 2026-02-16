# @github/copilot-sdk v0.1.19

**Release Date**: January 27, 2026  
**Release URL**: https://github.com/github/copilot-sdk/releases/tag/v0.1.19

## Summary

Documentation-heavy release with improvements to MCP server usage, community SDK examples, and dependency updates. Focus on developer experience and SDK ecosystem expansion.

## Key Changes

### 📚 Documentation

- **MCP Server Usage Documentation** (PR #98)
  - How to integrate Model Context Protocol servers
  - Configuration examples
  - Best practices for custom context providers

- **Community SDKs** (PR #178)
  - Added links to community-maintained SDK implementations
  - Expanded ecosystem visibility

- **Download Badges** (PR #156)
  - NPM download metrics in README
  - Visibility into SDK adoption

- **.NET Weather Assistant Example** (PR #119)
  - Interactive weather assistant implementation
  - Demonstrates custom tool integration

### 🔧 Improvements

- **Node.js Example Simplification** (PR #221)
  - Cleaner getting-started experience
  - Reduced boilerplate

- **Generated Events Schema Update** (PR #208)
  - Event types now match official schemas
  - Better TypeScript type safety

- **Go SDK Enhancements** (PR #213)
  - `ListSessions()` method
  - `DeleteSession()` method
  - Session management parity with Node.js SDK

- **.NET Error Handling** (PR #202)
  - Hides StreamJsonRpc implementation details
  - Exposes cleaner IOException interface

### 🗑️ Cleanup

- **Removed samples directory** (PR #210)
  - Links to awesome-copilot resources instead
  - Reduces maintenance burden

### 🔒 Security & Dependencies

- Bump actions/download-artifact 6.0.0 → 7.0.0
- Bump actions/checkout 5.0.1 → 6.0.1

## Contributors

**New Contributors**:
- @mohamedaminehamdi - BYOK documentation clarification
- @brunoborges - Community SDK visibility
- @AnassKartit - MCP documentation
- @vicperdana - .NET examples

## Impact on vscode-copilot-cli-extension

**Relevance**: ⚠️ Medium - Mostly documentation and examples

- **MCP Server Documentation** - Useful reference for our MCP integration
- **Event Schema Updates** - May affect our event handling if we upgrade
- No breaking changes or critical bug fixes

## Full Changelog

https://github.com/github/copilot-sdk/compare/v0.1.18...v0.1.19
