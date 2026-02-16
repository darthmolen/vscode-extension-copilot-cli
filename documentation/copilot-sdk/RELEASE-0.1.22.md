# @github/copilot-sdk v0.1.22

**Release Date**: February 5, 2026  
**Release URL**: https://github.com/github/copilot-sdk/releases/tag/v0.1.22

## Summary

**Critical bug fixes** for Node.js process hangs, CI mode failures, and Windows subprocess resolution. Plus comprehensive SDK documentation improvements.

## Key Changes

### 🐛 Critical Bug Fixes

- **Fix Process Hang in sendAndWait** (PR #349) 🔥
  - Clear timeout timer properly
  - **Prevents Node.js process from hanging indefinitely**
  - Critical for production stability

- **Fix CI Mode Exit** (PR #345)
  - Add missing return after exitWithNoMatchingRequestError
  - CI mode now exits properly on errors

- **Windows Subprocess Resolution** (PR #338)
  - Fixes .cmd/.bat CLI executable resolution
  - Windows users can now use SDK properly

### 📚 Documentation

- **Comprehensive SDK Documentation** (PR #352)
  - Major documentation overhaul
  - All SDK features documented

- **Documentation Accuracy Fixes** (PR #354)
  - Corrected outdated information
  - Improved examples

- **Documentation Code Validation** (PR #356)
  - Automated system to validate code examples
  - Prevents documentation drift

- **Go Weather Example** (PR #318)
  - Step 5 interactive weather assistant in Go
  - Demonstrates custom tool integration

### 🔧 Improvements

- **ResumeSessionConfig Parity** (PR #376)
  - Missing options added for consistency with create
  - Feature parity between create/resume

- **Setup Copilot Instructions** (PR #226)
  - Fixes issue #158
  - Better onboarding documentation

### 🗑️ Cleanup

- **Remove duplicate typing-extensions** (PR #147)
  - Cleaner Python dev dependencies

- **Move to slnx** (PR #374)
  - Modern .NET solution format

### 🔒 Dependencies

- Bump githubnext/gh-aw 0.38.2 → 0.39.4
- Combined dependency updates (PR #373)

## Contributors

**New Contributors**:
- @Ota1022 - Go examples
- @jaredpar - .NET tooling improvements

## Impact on vscode-copilot-cli-extension

**Relevance**: ✅ **CRITICAL** - We are currently on 0.1.22

### Why We Chose This Version

**Node 20 Compatibility** + **Critical Bug Fixes**

This is the version we upgraded to in v3.0.1 prep because:
1. **Compatible with Node 20.20** (our current version)
2. **Fixes sendAndWait hang** - prevents process hangs
3. **Stable release** with comprehensive testing

### Direct Benefits

**1. No More Process Hangs** (PR #349)
- Extension stability improved
- Prevents timeout-related freezes

**2. Better Session Resumption** (PR #376)
- ResumeSessionConfig now has full options
- May improve our session switching logic

**3. Windows Support** (PR #338)
- Windows users benefit from subprocess fix
- Better cross-platform reliability

### Known Limitations

- Still on Node 20 (v0.1.23 requires Node 24+)
- Missing v0.1.23 bundling improvements

## Full Changelog

https://github.com/github/copilot-sdk/compare/v0.1.21...v0.1.22
