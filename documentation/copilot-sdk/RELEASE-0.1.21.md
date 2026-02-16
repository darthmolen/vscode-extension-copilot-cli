# @github/copilot-sdk v0.1.21

**Release Date**: February 3, 2026  
**Release URL**: https://github.com/github/copilot-sdk/releases/tag/v0.1.21

## Summary

**Major release** with reasoning effort support, model caching to prevent rate limiting, ability to connect to running CLI instances, and extensive Go SDK improvements.

## Key Changes

### 🎉 New Features

- **Reasoning Effort Support** (PR #302)
  - All SDKs support `reasoning_effort` parameter
  - Control depth of model's thinking process
  - Useful for o1/o3 reasoning models

- **Connect to Running CLI Instance** (PR #346)
  - Ability to attach to already-running Copilot CLI
  - Enables debugging and inspection
  - Multi-client scenarios

- **Model List Caching** (PR #300)
  - Cache `list_models` across all SDK languages
  - Prevents rate limiting under high concurrency
  - **Critical for production apps**

### 🔧 Go SDK Improvements

- Honor `ClientOptions.UseStdio = false` (PR #296)
- Honor empty `ClientOptions.Env` (PR #297)
- Rewrite `interface{}` to `any` (PR #298)
- Make e2e and jsonrpc internal packages (PR #339)
- Accept and propagate context (PR #340)
- Cleanup Client implementation (PR #321)

### 🐛 Bug Fixes

- **Ask-user test snapshots** (PR #319)
  - Fixed test reliability issues

- **Model Final Response** (PR #307)
  - Add newline after model generating final response when tool call completes
  - Formatting consistency

### 📚 Documentation

- **FAQ Clarification** (PR #336)
  - BYOK works without GitHub Copilot subscription
  - Important licensing clarification

- **Python SessionConfig** (PR #325)
  - Replace Literal model type with string
  - Better type compatibility

### 🔒 Testing & Infrastructure

- **Fail CI if snapshots aren't present** (PR #304)
  - Prevents silent test degradation

- **Update all dependencies** (PR #332)
  - Security and stability improvements

- **Bump Copilot to 0.0.402** (PR #348)
  - Latest CLI version integration

### 🔧 Dependencies

- Bump githubnext/gh-aw 0.37.31 → 0.38.2
- Bump @types/node 25.0.3 → 25.1.0
- Bump openai 6.15.0 → 6.17.0

## Contributors

**New Contributors**:
- @qmuntal - Extensive Go SDK improvements
- @moonshade9 - Model response formatting
- @lossyrob - BYOK documentation

## Impact on vscode-copilot-cli-extension

**Relevance**: ✅ **CRITICAL** - Multiple high-impact features

### Immediate Impact

**1. Model List Caching (PR #300)** 🔥
- **We likely have rate limiting issues we don't know about**
- Extension may be hitting rate limits during model validation
- Should investigate if this fixes model capabilities service slowness

**2. Reasoning Effort Support (PR #302)**
- Could expose this in our UI for o1/o3 models
- Better control over thinking depth
- Potential performance/cost optimization

**3. Connect to Running CLI (PR #346)**
- **Debugging capability!**
- Could help diagnose session issues
- Useful for development and troubleshooting

### Recommended Actions

1. **Test if model caching fixes any latency issues** we've seen
2. **Consider exposing reasoning_effort** in extension settings
3. **Document "connect to running CLI"** for debugging workflows

### Breaking Changes

None - all features are additive

## Full Changelog

https://github.com/github/copilot-sdk/compare/v0.1.20...v0.1.21
