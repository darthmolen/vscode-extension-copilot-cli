# Planner → Implementer → Reviewer Flow

This is the most exciting possibility. Instead of our current dual-session plan mode (separate sessions for plan and work), we could define a three-agent pipeline within a **single session** using `customAgents`:

```typescript
const session = await client.createSession({
    customAgents: [
        {
            name: "planner",
            displayName: "Planner",
            description: "Analyzes requirements, explores the codebase, and writes a structured implementation plan. Does not write code.",
            tools: ["grep", "glob", "view", "bash"],  // read-only exploration
            prompt: `You are a planning agent. Your job is to:
1. Understand the user's request
2. Explore the relevant codebase sections
3. Write a clear, structured implementation plan to plan.md
4. Break the work into independent tasks suitable for parallel execution
Do not modify source files. Only write to plan.md.`,
            infer: false,  // only activate explicitly, not by runtime inference
        },
        {
            name: "implementer",
            displayName: "Implementer",
            description: "Implements code changes based on the plan in plan.md.",
            tools: ["view", "edit", "bash", "create", "grep", "glob"],
            prompt: `You are an implementation agent. Your job is to:
1. Read plan.md for the implementation specification
2. Make precise, minimal code changes as specified
3. Run tests to verify your changes
4. Do not deviate from the plan without user confirmation.`,
            infer: false,
        },
        {
            name: "reviewer",
            displayName: "Reviewer",
            description: "Reviews code changes for correctness, test coverage, and style.",
            tools: ["grep", "glob", "view", "bash"],  // read-only + can run tests
            prompt: `You are a code review agent. Your job is to:
1. Review all changes made against the plan in plan.md
2. Run tests and report results
3. Identify any gaps, bugs, or style issues
4. Summarize what was completed and what needs follow-up.`,
            infer: false,
        },
    ],
    agent: "planner",  // start in planner mode
});
```

**Flow**:
1. User describes feature → session starts in `planner` agent
2. Planner explores codebase, writes `plan.md` → `session.task_complete` fires
3. UI shows "Plan ready" → user clicks "Implement" → `rpc.agent.select({ name: "implementer" })`
4. Implementer executes the plan → optionally calls `rpc.fleet.start()` for parallel tasks
5. Implementation complete → UI shows "Review" → `rpc.agent.select({ name: "reviewer" })`
6. Reviewer audits changes, runs tests, posts summary

**Compared to current dual-session plan mode:**

| | Current dual-session | Custom agents |
|--|--|--|
| Sessions | 2 (work + plan) | 1 |
| Context shared | No (separate sessions) | Yes (same session history) |
| Plan mode switching | `enablePlanMode()` / `disablePlanMode()` | `rpc.agent.select()` |
| Tool restriction | `availableTools` whitelist | Per-agent `tools` array |
| Session lifecycle | Complex (destroy/resume) | Simple (always same session) |
| Fleet integration | After disablePlanMode | After implementer starts |

**Both workflows coexist — selected via a toolbar dropdown (see [Opportunity F](#opportunity-f-workflow-dropdown-in-sessiontoolbar)).**

---

## Opportunity F: Workflow Dropdown in SessionToolbar

**Decision**: Both `plan/work` and `plan/implement/review` workflows coexist. Users choose via a dropdown in the top toolbar. This is not a per-session setting — it configures what the next NEW session will use. Existing sessions keep their workflow.

#### Current SessionToolbar layout
```
[●] Copilot CLI  [Session: ▼ abc123]  [+]  [📋]
```
The usage metrics (Window %, Used, Remaining) currently live in `StatusBar` at the **bottom** of the input area.

#### New SessionToolbar layout
```
[●]  [Workflow: ▼]  Copilot CLI  [Session: ▼ abc123]  [+]  [📋]
     Window: 12% | Used: 4.2k | Remaining: 47
```

**Changes:**
1. **Move metrics** from `StatusBar` (bottom) to just **below the status dot** in `SessionToolbar` (top). Moves them out of the crowded input footer and into a more logical "session health at a glance" position near the status indicator.
2. **Add Workflow dropdown** to `SessionToolbar`, adjacent to the status dot. Positioned first in the toolbar so it's clearly a "session configuration" control, not a per-message one.
3. **Strip metrics from `StatusBar`** — it becomes reasoning indicator + help button only.

#### Workflow options

| Value | Label | Behavior |
|-------|-------|----------|
| `plan-work` | `Plan / Work` | Current dual-session plan mode (default, unchanged) |
| `plan-implement-review` | `Plan / Implement / Review` | New 3-agent single-session flow |

#### SessionToolbar HTML sketch
```html
<div class="header session-toolbar">
  <div class="session-toolbar__left">
    <div class="status-indicator" id="statusIndicator"></div>
    <div class="session-toolbar__workflow-group">
      <label for="workflowDropdown" class="session-toolbar__label">Workflow:</label>
      <select id="workflowDropdown" class="session-toolbar__select session-toolbar__select--workflow">
        <option value="plan-work">Plan / Work</option>
        <option value="plan-implement-review">Plan / Implement / Review</option>
      </select>
    </div>
  </div>
  <h2 class="session-toolbar__title">Copilot CLI</h2>
  <div class="session-toolbar__right">
    <div class="session-toolbar__metrics" id="toolbarMetrics">
      <!-- populated by updateMetrics() -->
    </div>
    <div class="session-selector session-toolbar__selector-group">
      <label for="sessionDropdown">Session:</label>
      <select id="sessionDropdown">...</select>
      <button id="newSessionBtn">+</button>
    </div>
    <button id="viewPlanBtn">📋</button>
  </div>
</div>
```

#### RPC message: `workflowChanged`

The webview sends this to the extension when the dropdown changes:
```typescript
// webview → extension
{ type: 'workflowChanged', workflow: 'plan-work' | 'plan-implement-review' }
```

The extension stores the selected workflow and applies it on the next `createSession()` call:
- `plan-work` → current `enablePlanMode()` / `disablePlanMode()` dual-session flow
- `plan-implement-review` → `customAgents: [planner, implementer, reviewer]` + `agent: 'planner'`

The acceptance controls adapt based on active workflow:
- `plan-work` → current "Accept / Reject / Accept + Fleet" buttons
- `plan-implement-review` → "Implement" (advance to implementer) / "Reject" buttons; reviewer phase gets "Review Complete" / "Request Changes"



3. **Plan / Implement / Review workflow** (needs task 1):
   - `customAgents: [planner, implementer, reviewer]` in `sdkSessionManager.ts`
   - `plan-implement-review` branch in `createSession()` path
   - `AcceptanceControls` adapts to workflow: "Implement" / "Reject" in planner phase; "Review Complete" / "Request Changes" in reviewer phase
   - `rpc.agent.select()` on phase advance
   - `session.task_complete` triggers phase-ready indicator in UI