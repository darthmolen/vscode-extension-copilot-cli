# Testing Strategy for 3.0 Refactor

## Overview

This document outlines the comprehensive testing strategy for the 3.0 code refactor. The goal is to ensure that the refactoring maintains all existing functionality while improving code quality and maintainability.

## Current Testing Landscape

### Existing Tests
Based on the `tests/` directory analysis:

**Functional Tests**:
- `plan-mode-*.test.js` - Plan mode functionality tests (multiple test files)
- `mcp-integration.test.js` - MCP integration tests  
- `sdk-*.mjs` - SDK integration tests
- `session-timeout.test.js` - Session management tests
- `extension.test.ts/js` - Extension-level tests

**Test Structure**:
- Individual feature-based test files
- Integration tests for plan mode
- MCP server integration tests
- SDK integration tests

### Test Commands
```bash
npm run test                  # Run plan-mode tests (default)
npm run test:plan-mode        # Plan mode integration tests
npm run test:mcp              # MCP integration tests
npm run test:integration      # SDK integration tests
npm run test:verify           # Setup verification
npm run check-types           # TypeScript type checking ✅ WORKS
npm run lint                  # ESLint ✅ WORKS
npm run build                 # Build extension ✅ WORKS
```

## Testing Strategy by Phase

### Phase 0: Preparation & Setup ✅ COMPLETE

**Testing Done**:
- [x] TypeScript type checking baseline (passes)
- [x] Extension build verification (passes)
- [x] Surveyed existing test suites

**Test Status**:
- ✅ TypeScript type checking works
- ✅ Build system works
- ✅ Multiple test suites exist (plan-mode, MCP, SDK integration)
- ⚠️ Need to verify existing tests run correctly before Phase 1

---

### Phase 1: Extract HTML/CSS/JS

**Goal**: Ensure extracted webview code works identically to embedded version

**Test Strategy**:

1. **Pre-Refactor Testing**
   - [ ] Fix evaluation framework or create minimal replacement
   - [ ] Get plan-mode tests running (most likely to work)
   - [ ] Document current behavior as baseline
   - [ ] Take screenshots of webview UI in different states

2. **During Refactor**
   - [ ] After each file extraction, manually test webview loads
   - [ ] Verify no console errors in webview DevTools
   - [ ] Check CSP headers don't block resources

3. **Post-Refactor Validation**
   - [ ] All plan-mode tests still pass
   - [ ] Manual webview functionality checklist:
     - [ ] Webview opens and renders
     - [ ] Chat messages send/receive
     - [ ] Markdown rendering works
     - [ ] Code blocks with syntax highlighting work
     - [ ] Plan mode toggle works
     - [ ] Session switching works
     - [ ] No visual regressions (compare screenshots)
   - [ ] TypeScript compilation still passes
   - [ ] Extension builds successfully

4. **New Tests to Add**
   - [ ] Webview loading test (verify HTML loads from file)
   - [ ] CSP compliance test
   - [ ] Resource loading test (CSS, JS files found)

**Rollback Criteria**: If webview fails to load or shows visual regressions, rollback and debug

---

### Phase 2: Create Typed RPC Layer

**Goal**: Ensure message passing works with new typed system

**Test Strategy**:

1. **During Refactor**
   - [ ] Gradually migrate message handlers one at a time
   - [ ] Keep both old and new systems running in parallel initially
   - [ ] Test each message type after migration

2. **Post-Refactor Validation**
   - [ ] All existing tests still pass
   - [ ] Manual message flow testing:
     - [ ] Send message from webview → extension
     - [ ] Receive response from extension → webview
     - [ ] Test all message types in `shared/messages.ts`
   - [ ] TypeScript autocomplete works for message types
   - [ ] No runtime type errors

3. **New Tests to Add**
   - [ ] RPC client unit tests (webview side)
   - [ ] RPC router unit tests (extension side)
   - [ ] Message serialization/deserialization tests
   - [ ] Type safety tests (should fail to compile with wrong types)

**Rollback Criteria**: If messages fail to pass or types don't work, rollback and debug

---

### Phase 3: Extract Backend Services

**Goal**: Ensure service extraction doesn't break functionality

**Test Strategy**:

1. **During Refactor**
   - [ ] Extract one service at a time
   - [ ] Write unit tests for each service before extracting
   - [ ] Test service in isolation with mocks
   - [ ] Test integration after wiring up

2. **Post-Refactor Validation**
   - [ ] All existing tests still pass
   - [ ] Manual end-to-end testing:
     - [ ] Create new session
     - [ ] Send messages
     - [ ] Switch sessions
     - [ ] Plan mode workflows
     - [ ] MCP integration (if applicable)

3. **New Tests to Add**

   **SessionService Tests**:
   - [ ] Create session
   - [ ] Delete session
   - [ ] Switch active session
   - [ ] List sessions
   - [ ] Session state directory creation

   **CopilotService Tests**:
   - [ ] Initialize agent
   - [ ] Send prompt
   - [ ] Handle streaming
   - [ ] Abort stream
   - [ ] Error handling

   **PlanModeService Tests**:
   - [ ] Enable/disable plan mode
   - [ ] Load plan file
   - [ ] Save plan file
   - [ ] Accept/reject plan

   **ToolPermissionService Tests**:
   - [ ] Request permission
   - [ ] Save permission
   - [ ] Retrieve saved permission
   - [ ] Permission denial

   **CliServerService Tests** (if applicable):
   - [ ] Start server
   - [ ] Stop server
   - [ ] Server status

4. **Integration Tests**
   - [ ] Service dependency injection works
   - [ ] Services communicate correctly
   - [ ] No circular dependencies
   - [ ] Service lifecycle management

**Rollback Criteria**: If any service fails or tests don't pass, rollback that service

---

### Phase 4: Componentize Webview UI

**Goal**: Ensure UI components render and behave correctly

**Test Strategy**:

1. **During Refactor**
   - [ ] Test each component in isolation as extracted
   - [ ] Verify component renders with mock state
   - [ ] Test event handlers

2. **Post-Refactor Validation**
   - [ ] All existing tests still pass
   - [ ] Visual regression testing (screenshots)
   - [ ] Performance testing (render times)
   - [ ] No memory leaks (component cleanup)

3. **New Tests to Add**

   **Component Tests** (if using test framework):
   - [ ] Chat component renders messages
   - [ ] InputArea handles user input
   - [ ] SessionSelector displays sessions
   - [ ] PlanMode component shows/hides correctly
   - [ ] Toolbar buttons work

   **State Management Tests**:
   - [ ] State updates trigger re-renders
   - [ ] State subscriptions work
   - [ ] State changes are immutable

   **Integration Tests**:
   - [ ] Components compose correctly
   - [ ] Components communicate via state
   - [ ] RPC integration works from components

**Rollback Criteria**: If UI breaks or performance degrades, rollback

---

### Phase 5: MCP Integration Preparation

**Goal**: Ensure MCP features work alongside existing functionality

**Test Strategy**:

1. **Pre-Implementation**
   - [ ] Study existing MCP tests
   - [ ] Define MCP test scenarios
   - [ ] Set up test MCP servers

2. **During Implementation**
   - [ ] Unit test MCP service
   - [ ] Test MCP UI components
   - [ ] Test MCP/SDK coexistence

3. **Post-Implementation Validation**
   - [ ] All existing tests still pass
   - [ ] MCP integration tests pass
   - [ ] Manual MCP workflow testing:
     - [ ] Connect to MCP server
     - [ ] Browse resources
     - [ ] Invoke tools
     - [ ] Disconnect from server

4. **New Tests to Add**

   **McpService Tests**:
   - [ ] Connect to server
   - [ ] Disconnect from server
   - [ ] List resources
   - [ ] Get resource
   - [ ] Invoke tool
   - [ ] Error handling (connection failures)

   **MCP UI Tests**:
   - [ ] Server list renders
   - [ ] Resource browser works
   - [ ] Tool palette displays
   - [ ] Configuration dialog works

   **Integration Tests**:
   - [ ] MCP and SDK coexist
   - [ ] Switch between modes
   - [ ] MCP tools work in chat
   - [ ] Multiple MCP servers

**Rollback Criteria**: If MCP breaks existing functionality, disable MCP features

---

## Continuous Testing Practices

### For Every Phase:

1. **Before Starting**
   - [ ] Run all passing tests
   - [ ] Document baseline behavior
   - [ ] Create feature branch

2. **During Implementation**
   - [ ] Make small commits
   - [ ] Test after each significant change
   - [ ] Keep tests passing (don't accumulate failures)

3. **Before Completing**
   - [ ] Run full test suite
   - [ ] Run TypeScript type checking
   - [ ] Manual smoke testing
   - [ ] Build and install .vsix package
   - [ ] Test in real VS Code instance

4. **After Completing**
   - [ ] Update phase document with test results
   - [ ] Document any new test failures
   - [ ] Commit and tag phase completion

### Test Commands to Run

```bash
# Type checking (always run)
npm run check-types

# Build verification
npm run build

# Linting
npm run lint

# Unit tests (once working)
npm run test:plan-mode
npm run test:mcp
npm run test:integration

# Manual testing
# 1. Build .vsix: vsce package
# 2. Install in VS Code
# 3. Run through manual test checklist
```

---

## Manual Test Checklist

This checklist should be run after each phase completion:

### Basic Functionality
- [ ] Extension activates without errors
- [ ] Chat panel opens
- [ ] Can create new session
- [ ] Can send message to agent
- [ ] Agent responds (streaming works)
- [ ] Messages render with markdown
- [ ] Code blocks have syntax highlighting
- [ ] Can switch between sessions
- [ ] Session list updates correctly

### Plan Mode
- [ ] Can toggle plan mode on/off
- [ ] Plan mode UI appears when enabled
- [ ] Can view plan file
- [ ] Can accept plan
- [ ] Can reject plan
- [ ] Plan mode indicator shows correctly

### MCP (Phase 5+)
- [ ] Can see MCP server list
- [ ] Can connect to MCP server
- [ ] Can browse MCP resources
- [ ] Can invoke MCP tools
- [ ] Can disconnect from MCP server

### Error Handling
- [ ] Graceful error on agent failure
- [ ] Graceful error on invalid session
- [ ] Webview recovers from errors
- [ ] Console has no unexpected errors

### Performance
- [ ] Panel opens quickly (<1s)
- [ ] Messages render quickly
- [ ] No lag when typing
- [ ] Large message lists scroll smoothly

---

## Test Coverage Goals

### Phase 1: Extract HTML/CSS/JS
- Target: 70% coverage of webview loading code
- Focus: Resource loading, CSP compliance

### Phase 2: RPC Layer
- Target: 90% coverage of RPC client/router
- Focus: Message type safety, serialization

### Phase 3: Services
- Target: 85% coverage of service layer
- Focus: Business logic, service interactions

### Phase 4: Components
- Target: 80% coverage of UI components
- Focus: Rendering, event handling, state

### Phase 5: MCP
- Target: 85% coverage of MCP service
- Focus: Protocol compliance, error handling

---

## Fixing Pre-existing Test Issues

### Immediate Actions Needed

1. **Verify Existing Tests Run**
   ```bash
   # Try each test suite to see which ones work
   npm run test:plan-mode
   npm run test:mcp
   npm run test:integration
   npm run test:verify
   ```

2. **Get Baseline Test Suite Working**
   - Start with simplest test (e.g., plan-mode-tools.test.js)
   - Verify it runs and passes
   - Use as regression test baseline

3. **Document Working Tests**
   - Create list of tests that currently pass
   - Create list of tests that need fixing
   - Focus on keeping working tests passing during refactor

---

## Success Criteria

### Per Phase
- ✅ All previously passing tests still pass
- ✅ New tests for phase features pass
- ✅ TypeScript compilation passes
- ✅ Manual test checklist passes
- ✅ No performance regressions

### Overall (End of All Phases)
- ✅ 80%+ test coverage on new code
- ✅ All manual tests pass
- ✅ No functional regressions
- ✅ Tests are maintainable and well-organized
- ✅ CI/CD pipeline works (if applicable)

---

## Tools & Frameworks

### Current
- TypeScript for type checking
- Manual testing
- Node.js test runner (for .js tests)

### Potential Additions
- Mocha/Jest for unit testing
- VS Code test runner for extension tests
- Istanbul/nyc for coverage
- Playwright for webview UI testing (advanced)

### Recommended for Each Phase
- **Phase 1-2**: Manual testing + TypeScript is sufficient
- **Phase 3**: Add unit testing framework (Mocha or Jest)
- **Phase 4**: Consider component testing library
- **Phase 5**: Comprehensive integration tests

---

## Risk Mitigation

### High Risk Areas
1. **Webview CSP changes** (Phase 1)
   - Mitigation: Test extensively, have rollback plan
   
2. **Message contract changes** (Phase 2)
   - Mitigation: Parallel old/new systems, gradual migration
   
3. **Service extraction breaking dependencies** (Phase 3)
   - Mitigation: Extract one service at a time, test continuously
   
4. **UI component regressions** (Phase 4)
   - Mitigation: Visual regression testing, screenshots
   
5. **MCP protocol issues** (Phase 5)
   - Mitigation: Test with multiple MCP servers, robust error handling

### General Mitigation
- Small commits with clear messages
- Feature branches for each phase
- Keep main branch stable
- Tag each phase completion
- Document any breaking changes

---

## Next Steps

1. **Immediate** (Before Phase 1):
   - [ ] Fix or work around evaluation framework issue
   - [ ] Get at least one test suite running
   - [ ] Establish testing baseline

2. **Phase 1**:
   - [ ] Run manual test checklist before extracting HTML
   - [ ] Test webview loading after extraction
   - [ ] Verify no regressions

3. **Phase 2+**:
   - [ ] Add unit test framework
   - [ ] Write tests for each new module
   - [ ] Maintain >80% coverage

---

## Conclusion

Testing is critical for this refactor. Each phase must maintain existing functionality while adding new structure. The strategy is:

1. **Preserve what works** - Keep passing tests passing
2. **Test incrementally** - Don't accumulate test debt
3. **Mix automated and manual** - Use both strategically  
4. **Focus on regression prevention** - Don't break existing features
5. **Build test infrastructure gradually** - Add as needed per phase

This ensures the refactor succeeds without introducing bugs.
