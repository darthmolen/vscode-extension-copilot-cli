# Phase 4 Componentization Review

**MANDATORY**All phases MUST use RED-GREEN-REFACTOR TDD and test-driven-development skills.

## Status: Phase 4.4 Complete ✅

**Completed:**
- Phase 4.0: Refactoring for Testability ✅
  - 16 handlers extracted from main.js
  - 62 tests written and verified by breaking code
  - Extension-side diff bug fixed with RED-GREEN-REFACTOR
  - TDD victory documented

- Phase 4.1: EventBus State Management ✅
  - EventBus.js component created (82 lines)
  - Pub/sub pattern for component communication
  - 11 component tests passing
  - Integration tests verify main.js → EventBus flow

- Phase 4.2: MessageDisplay Component ✅
  - MessageDisplay.js component created (259 lines)
  - Handles user/assistant/reasoning/error messages
  - Markdown parsing, attachment rendering, empty state
  - 19 component tests passing
  - 8 integration tests passing
  - main.js reduced: 952 → 931 lines

- Phase 4.3: ToolExecution Component ✅
  - ToolExecution.js component created (309 lines)
  - Tool group rendering, expand/collapse, diff buttons, progress updates
  - 19 component tests passing
  - 8 integration tests passing
  - main.js reduced: 931 → 727 lines (-204 lines)
  - Fixed buildToolHtml bug with proper RED-GREEN-REFACTOR
  - Updated esbuild.js for component deployment
  - Updated copilot-instructions.md with critical warnings

- Phase 4.4: InputArea Component ✅
  - InputArea.js component created (249 lines)
  - Message input, send/abort, attachment preview, auto-resize, history navigation
  - 27 component tests passing
  - 9 integration tests passing
  - main.js reduced: 727 → 590 lines (-137 lines = -19% reduction)
  - Updated esbuild.js for component deployment
  - Critical deployment checklist documented

## Current Webview Structure

**File:** `src/webview/main.js` - **590 lines** (was 952)

**Directory Structure:**
```
src/webview/
├── main.js (590 lines - componentized!)
├── styles.css
└── app/
    ├── components/
    │   ├── EventBus/EventBus.js (82 lines)
    │   ├── MessageDisplay/MessageDisplay.js (259 lines)
    │   ├── ToolExecution/ToolExecution.js (309 lines)
    │   └── InputArea/InputArea.js (249 lines)
    ├── handlers/ (16 extracted handlers)
    ├── rpc/ (WebviewRpcClient)
    ├── state/ (BackendState)
    └── utils/
```

**What Phases 0-4.4 Achieved:**
- ✅ Extracted 16 testable handlers from main.js
- ✅ Created EventBus for component communication
- ✅ Extracted MessageDisplay component (259 lines)
- ✅ Extracted ToolExecution component (309 lines)
- ✅ Extracted InputArea component (249 lines)
- ✅ Reduced main.js from 952 → 590 lines (-362 lines = -38% reduction!)
- ✅ 116+ tests passing (component + integration)
- ✅ Proper TDD discipline enforced
- ✅ Build system updated for component deployment

## Remaining Componentization Opportunities

Based on reviewing main.js (727 lines remaining), here are components left to extract:

### ✅ 1. **Message Display Component** (~200 lines) - COMPLETE
**Done in Phase 4.2**
- MessageDisplay.js component (259 lines)
- 19 component tests + 8 integration tests passing
- Handles user/assistant/reasoning/error messages
- Markdown parsing, attachments, empty state

---

### ✅ 2. **Tool Execution Display Component** (~150 lines) - COMPLETE
**Done in Phase 4.3**
- ToolExecution.js component (309 lines)
- 19 component tests + 8 integration tests passing
- Tool grouping, expand/collapse, diff buttons, progress
- Fixed buildToolHtml bug with proper TDD

---

### ✅ 3. **Input Area Component** (~100 lines) - COMPLETE
**Done in Phase 4.4**
- InputArea.js component (249 lines)
- 27 component tests + 9 integration tests passing
- Message input, send/abort, attachment preview, auto-resize, history navigation
- main.js reduced: 727 → 590 lines (-137 lines)

---

### 4. **Session Toolbar Component** (~80 lines) - IN PROGRESS 🎯
**Current Code:**
- Session selector dropdown
- New session button
- View plan button
- Plan mode buttons (enter/accept/reject)
- `updatePlanModeUI()` logic

**Value:**
- Clear UI section
- Independent state (session list, plan mode)
- Easy to make responsive

**Effort:** Low (simple component)

**Tests Needed:**
- Component tests: session selection, new session, view plan, plan mode toggles
- Integration tests: main.js wiring, EventBus events

---

### 5. **Status/Metadata Bar Component** (~60 lines)
**Current Code:**
- Status indicator (active/idle)
- Reasoning indicator
- Usage window display (quota)
- Focus file info display

**Value:**
- Independent display-only component
- No complex interactions
- Clean separation

**Effort:** Low (mostly display)

---

### 6. **Acceptance Controls Component** (~50 lines)
**Current Code:**
- Acceptance input textarea
- "Accept and Work" button
- "Keep Planning" button
- Swap controls logic (`swapToAcceptanceControls()`, `swapToRegularControls()`)

**Value:**
- Self-contained feature
- Clear state transitions
- Already has extracted handlers

**Effort:** Low

**Tests Needed:**
- Component tests: swap logic, accept button, keep planning button
- Integration tests: plan mode flow

---

### 7. **Attachment Preview Component** (~40 lines)
**Current Code:**
- Attachment thumbnail display
- Remove attachment button
- `updateAttachmentsPreview()`
- `updateAttachCount()`

**Value:**
- Reusable for both pending and sent attachments
- Independent state (pendingAttachments array)
- Clear boundaries

**Effort:** Low

---

## ⚠️ CRITICAL: Component Deployment Checklist

**Every time you add a new component, you MUST:**

1. **Write failing tests (RED)** → Run tests → Verify FAIL
2. **Create component file** → `src/webview/app/components/ComponentName/ComponentName.js`
3. **Import in main.js** → `import { ComponentName } from './app/components/ComponentName/ComponentName.js';`
4. **Update esbuild.js** → Add directory + copyFileSync() (see example below)
5. **Run tests (GREEN)** → Verify PASS
6. **Build extension** → `./test-extension.sh`
7. **Manual test** → Reload VS Code, verify component works

**esbuild.js Template:**
```javascript
// Add to directory creation section
const componentNameDistDir = path.join(componentsDistDir, 'ComponentName');
if (!fs.existsSync(componentNameDistDir)) {
    fs.mkdirSync(componentNameDistDir, { recursive: true });
}

// Add to copy section (after other components)
fs.copyFileSync(
    path.join(__dirname, 'src', 'webview', 'app', 'components', 'ComponentName', 'ComponentName.js'),
    path.join(componentNameDistDir, 'ComponentName.js')
);
```

**If you forget esbuild.js:**
- Extension builds successfully ✅
- Tests pass ✅
- But VSIX fails at runtime ❌ with "ERR Webview.loadLocalResource"
- Files are missing from dist/webview/app/components/

**Verification:**
```bash
npx @vscode/vsce ls copilot-cli-extension-*.vsix | grep ComponentName
```

## Components NOT Worth Extracting

### ❌ RPC Message Handling (~300 lines)
**Why Skip:**
- Already has WebviewRpcClient abstraction
- Message routing is inherently top-level
- Would just move complexity without benefit
- Better to keep centralized in main.js

### ❌ Thinking/Reasoning Indicators
**Why Skip:**
- Simple show/hide logic
- Part of message display component
- Not worth separate component

### ❌ Global State Variables
**Why Skip:**
- Need centralized state management first
- Covered in Phase 4.1's state manager plan

## Recommended Prioritization

### Phase 4.1-4.7: All Core Components ✅ COMPLETE
1. ✅ **EventBus** - State management foundation (82 lines)
2. ✅ **Message Display** - Biggest complexity reduction (259 lines)
3. ✅ **Tool Execution Display** - Second most complex (309 lines)
4. ✅ **Input Area** - Needed for sidebar responsiveness (249 lines)
5. ✅ **Session Toolbar** - Session management + plan mode controls (165 lines)
6. ✅ **Acceptance Controls** - Acceptance input and buttons (160 lines)
7. ✅ **Status Bar** - Reasoning indicator and usage stats (180 lines)

**Result:** main.js reduced from 952 → 590 lines (-362 lines = -38% reduction!)
**Components:** 7 components totaling 1,404 lines
**Tests:** 180 passing (EventBus + MessageDisplay + ToolExecution + InputArea: 95, SessionToolbar: 20, AcceptanceControls: 21, StatusBar: 23, Integration: 21)

---

## Phase 4 COMPONENTIZATION COMPLETE! 🎉

All 7 planned components created using strict TDD (RED-GREEN-REFACTOR).

**Next Steps:**
- [ ] Integrate all components into main.js
- [ ] Remove old code from main.js
- [ ] Integration testing
- [ ] Manual testing in VS Code
- [ ] Final cleanup

**Expected Final Result:** main.js: 952 → ~460 lines (52% reduction!)

### Phase 4.5-4.6: Remaining Components (IN PROGRESS)
5. 🎯 **Session Toolbar** - Helpful for sidebar
6. 🎯 **Acceptance Controls** - Self-contained feature

**Estimated Result:** main.js goes from 590 → ~460 lines

### Phase 4.7+: Low-Priority Components (Consider Later)
7. 🤷 **Status/Metadata Bar** - Minor value
8. 🤷 **Attachment Preview** - Minor value (already small)

**Result:** Diminishing returns, not worth the effort unless needed for sidebar

## Questions for Discussion

1. **Do all 7, or focus on top 3?**
   - Top 3 (Message, Tool, Input) = 80% of the value
   - Remaining 4 = 20% of value, 40% of effort

2. **State management approach?**
   - Keep simple: global variables + event emitters?
   - Or introduce lightweight pub/sub pattern?
   - Current plan has AppState class - still needed?

3. **Sidebar support timing?**
   - Do components first, then sidebar?
   - Or do sidebar alongside componentization?
   - Original plan: components THEN sidebar (Phase 4.2)

4. **TypeScript migration?**
   - Still optional (Phase 4.4)?
   - Or skip entirely and stay vanilla JS?

5. **Component file structure?**
   ```
   src/webview/app/components/
   ├── MessageDisplay/
   │   ├── MessageDisplay.js
   │   └── MessageDisplay.css (extract from styles.css)
   ├── ToolExecution/
   ├── InputArea/
   └── ...
   ```
   OR keep flatter?

## Next Steps

### ✅ Phase 4.4 - InputArea Component - COMPLETE
**Achieved:**
- ✅ 27 component tests passing
- ✅ 9 integration tests passing  
- ✅ main.js: 727 → 590 lines (-137 lines = -19% reduction)
- ✅ Extension built and installed
- ✅ esbuild.js updated
- ✅ Documentation updated

---

### Current: Phase 4.5 - SessionToolbar Component (TDD MANDATORY) 🎯
**RED Phase:**
- [ ] Write failing component tests (session selection, new session, view plan, plan mode toggles)
- [ ] Write failing integration tests (main.js wiring, EventBus events)
- [ ] Verify all tests FAIL correctly

**GREEN Phase:**
- [ ] Create SessionToolbar.js component
- [ ] Update main.js to use SessionToolbar
- [ ] Verify all tests PASS

**REFACTOR Phase:**
- [ ] Clean up, keep tests green
- [ ] Update esbuild.js

**Estimated:** 590 → ~510 lines (-80 lines)

---

### Next: Phase 4.6 - AcceptanceControls Component (TDD MANDATORY)
**RED Phase:**
- [ ] Write failing component tests (swap logic, accept button, keep planning button)
- [ ] Write failing integration tests (plan mode flow)
- [ ] Verify all tests FAIL correctly

**GREEN Phase:**
- [ ] Create AcceptanceControls.js component
- [ ] Update main.js to use AcceptanceControls
- [ ] Verify all tests PASS

**REFACTOR Phase:**
- [ ] Clean up, keep tests green
- [ ] Update esbuild.js

**Estimated:** ~510 → ~460 lines (-50 lines)

### Total Progress
- **Started:** 952 lines monolithic
- **After 4.4:** 590 lines (-362 = -38% reduction)
- **After 4.6:** ~460 lines (-492 total = 52% reduction!)
- **Tests:** 116+ passing, growing with each component

### Success Criteria
- ✅ All components use EventBus for communication
- ✅ All components have comprehensive tests
- ✅ All tests follow RED-GREEN-REFACTOR
- ✅ esbuild.js updated for each component
- ✅ Extension builds and installs successfully
- ✅ No regressions in production
