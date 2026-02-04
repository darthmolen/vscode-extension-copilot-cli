# Test Suite Changelog

Internal changelog for test suite development and improvements.

## [2.1.1] - 2026-02-04

### Session Management Tests

**Enhanced session-resume.test.js:**
- Added tests for empty session filtering (sessions with no messages)
- Added tests for corrupt session handling (malformed events.jsonl)
- Validates session list excludes invalid sessions
- Tests that only non-empty, valid sessions appear in dropdown

**Session State Tests:**
- Added tests for panel close/reopen behavior
- Validates that closing chat panel doesn't reload session from disk
- Tests that active session state persists when panel reopens
- Verifies background session continues without interruption

**All session tests passing:** ✅

### Bug Fix Validation

**Active File Tracking:**
- Added test coverage for `updateActiveFile()` behavior
- Tests editor undefined handling with visible editors check
- Validates active file persistence when focus moves to webview

## [2.0.6] - 2026-02-01

### Plan Mode Test Suites

**Added 3 comprehensive test suites (42 total tests):**

1. **plan-mode-safe-tools.test.mjs** (7 tests)
   - Tests renamed tools with availableTools whitelist
   - Verifies all expected tools work (plan_bash_explore, task_agent_type_explore, etc.)
   - Verifies blocked tools fail (SDK bash, create, edit, task)
   - Tests both custom and SDK tool integration

2. **plan-mode-restrictions.test.mjs** (26 tests)
   - Tests dangerous bash command blocking (9 commands)
   - Tests non-explore agent type blocking (6 agent types)
   - Tests non-plan file edit blocking (5 files)
   - Tests non-plan file creation blocking (5 files)
   - Tests error message clarity and helpfulness

3. **plan-mode-integration.test.mjs** (9 tests)
   - End-to-end workflow: create → update → edit → accept
   - Tests safe bash command execution
   - Tests dangerous bash command blocking
   - Tests explore agent dispatch
   - Tests non-explore agent blocking
   - Tests file creation/edit restriction enforcement

**All tests passing:** ✅ 42/42

### Documentation Organization

**Moved completed plans to planning/completed/:**
- PHASE-6-COMPLETE.md
- PHASE-6-SUMMARY.md
- INTEGRATION-TEST-PLAN.md
- pr-review-plan.md

**Updated tests/README.md:**
- Added comprehensive documentation index
- Added plan mode tests section with test counts
- Added reference to historical plans
- Documented all test commands including plan mode tests

**Remaining active documentation:**
- README.md - Main test guide
- TEST-SUITE-OVERVIEW.md - Architecture
- COMPREHENSIVE-TEST.md - Comprehensive test details
- QUICKREF-COMPREHENSIVE.md - Quick reference

### Technical Implementation

**Plan Mode Security Testing:**
- Tool name uniqueness validation
- availableTools whitelist enforcement
- Custom tool handler restriction validation
- Defense-in-depth security verification

**Test Framework:**
- Direct SDK integration (no mocks for plan mode tests)
- Real tool execution validation
- Event capture and verification
- Error message quality checks

## [2.0.5] - 2026-01-31

### SDK Plan Mode Tools Test

**Added sdk-plan-mode-tools.test.mjs:**
- Tests custom tools and SDK tools together
- Validates session creation with both tool types
- Verifies update_work_plan tool execution
- Tests restricted bash command blocking

## Previous Versions

See planning/completed/ for historical test planning documents.
