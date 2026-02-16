# @github/copilot-sdk v0.1.20

**Release Date**: January 30, 2026  
**Release URL**: https://github.com/github/copilot-sdk/releases/tag/v0.1.20

## Summary

**Major feature release** with authentication improvements, hooks system, user input handlers, and typed event filtering. Significant enhancements to SDK flexibility and developer experience.

## Key Changes

### 🎉 New Features

- **Hooks and User Input Handlers** (PR #269, #270)
  - Pre/post hooks for session lifecycle events
  - Custom user input handlers
  - E2E tests for all SDKs
  - **Documentation in all SDK READMEs**

- **Authentication Options** (PR #237)
  - `githubToken` option for custom token auth
  - `useLoggedInUser` option to use current GitHub user
  - Bypasses default authentication flow

- **Typed Event Filtering (Node.js)** (PR #272)
  - `session.on((event) => event.type === 'assistant.message', handler)`
  - Filter events with type safety
  - Cleaner event handling code

### 🔧 Improvements

- **Python SDK Dataclasses** (PR #216)
  - Consistent use of dataclasses across Python SDK
  - Better type hints and IDE support

- **Provider Info Documentation** (PR #257)
  - Azure Foundry version requirements
  - Provider-specific configuration

- **CI Optimization** (PR #259)
  - Split into separate workflows
  - Native path filtering
  - Faster CI runs

- **Dependabot Monitoring** (PR #273)
  - Automated dependency updates
  - npm, pip, gomod, nuget coverage

### 🐛 Bug Fixes

- **Premium Request Consumption** (PR #228)
  - Fixes issue #227
  - Prevented unnecessary premium request usage during `py dev test`

- **.NET CLI Server Mode** (PR #232)
  - Fixed code samples missing `UseStdio = false`

### 🔒 Dependencies

- Bump githubnext/gh-aw 0.37.13 → 0.37.31

## Contributors

**New Contributors**:
- @vivganes - Premium request fix

## Impact on vscode-copilot-cli-extension

**Relevance**: ✅ High - Multiple useful features

**Immediate Benefits**:
- **Hooks System** - Could improve our session lifecycle management
- **Typed Event Filtering** - Cleaner event handling in our SDK manager
- **Custom Auth** - Potential for workspace-specific tokens

**Potential Improvements**:
- Add typed event filtering to `sdkSessionManager.ts`
- Use hooks for better session transition handling
- Consider custom auth for multi-account scenarios

**Breaking Changes**: None - all features are opt-in

## Full Changelog

https://github.com/github/copilot-sdk/compare/v0.1.19...v0.1.20
