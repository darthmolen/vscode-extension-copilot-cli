# 3.6.0 — Custom Agents

## Problem Statement

The SDK's `customAgents` feature lets sessions define named agents with scoped tools, system prompts, and descriptions. Currently there's no way to configure them from the extension UI — they'd need to be hardcoded in `sdkSessionManager.ts`. We need a full CRUD UI so users can create, edit, and delete their own agents, plus ship three non-deletable built-in agents (Planner, Implementer, Reviewer) out of the box.

## Approach

Backend service reads/writes `copilotCLI.customAgents` workspace settings. A new webview pane component provides list + edit views. The toolbar gets a 🤖 button to toggle it. All agents (built-ins + user-defined) are passed to `customAgents` at session creation time.

## TDD Iron Laws (Non-Negotiable)

1. **Write the test FIRST** — test must import actual production code, not a mock
2. **Watch the test FAIL** — if it doesn't fail, it's not testing anything real
3. **Write minimal code** — only enough to make the test pass
4. Every test must cross component boundaries and verify side effects

---

## Tasks (RED → GREEN order)

### Phase 0: Type Foundations (no logic to fail, write first)

- [ ] **0a. models.ts** — Add `CustomAgentDefinition` interface:
  ```typescript
  export interface CustomAgentDefinition {
    name: string;            // slug, SDK name key
    displayName?: string;
    description?: string;
    prompt: string;
    tools?: string[] | null; // null/undefined = all tools
    builtIn?: boolean;       // true = non-deletable
  }
  ```

- [ ] **0b. messages.ts** — Add 4 new message types:
  - Webview→Extension: `getCustomAgents` (no payload), `saveCustomAgent` (agent: CustomAgentDefinition), `deleteCustomAgent` (name: string)
  - Extension→Webview: `customAgentsChanged` (agents: CustomAgentDefinition[])
  - Add all 4 to `WebviewMessageType`/`ExtensionMessageType` unions AND both type guard arrays

### Phase 1: Backend Service (RED → GREEN)

- [ ] **1a. RED — Write `tests/unit/extension/services/custom-agents-service.test.js`**
  - Loads from `out/extension/services/CustomAgentsService.js` (compiled)
  - Mocks `require('vscode')` via `Module.prototype.require` intercept
  - Mocks `vscode.workspace.getConfiguration` with tracked `update()` calls
  - Tests that MUST FAIL until service exists:
    - `getAll()` returns 3 built-in agents (planner, implementer, reviewer)
    - `getAll()` merges user-defined agents from config with built-ins
    - `getAll()` user agent with same `name` as built-in overrides it
    - `save(agent)` calls `config.update('customAgents', [...], true)`
    - `save(agent)` upserts (replaces existing by name)
    - `delete('my-agent')` removes from user agents array
    - `delete('planner')` throws (cannot delete built-in)
    - `toSDKAgents()` returns array without `builtIn` field
    - `toSDKAgents()` prompt field is always present

- [ ] **1b. GREEN — Create `src/extension/services/CustomAgentsService.ts`**
  ```typescript
  export const BUILT_IN_AGENTS: CustomAgentDefinition[] = [
    { name: 'planner', displayName: 'Planner', description: 'Read-only exploration; writes plan.md', prompt: '...', tools: ['view', 'grep', 'glob', 'plan_bash_explore', 'update_work_plan', 'present_plan', 'create_plan_file', 'edit_plan_file', 'task_agent_type_explore'], builtIn: true },
    { name: 'implementer', displayName: 'Implementer', description: 'Executes plan; edits source files', prompt: '...', builtIn: true },
    { name: 'reviewer', displayName: 'Reviewer', description: 'Reads and runs tests; posts summary', prompt: '...', tools: ['view', 'grep', 'glob', 'bash'], builtIn: true },
  ];
  export class CustomAgentsService {
    getAll(): CustomAgentDefinition[]         // built-ins merged with workspace config
    save(agent: CustomAgentDefinition): void  // upsert into copilotCLI.customAgents
    delete(name: string): void                // guard built-ins; remove from config
    toSDKAgents(): CustomAgentConfig[]        // strip builtIn flag for SDK
  }
  ```
  - Run test → verify GREEN ✅

### Phase 2: RPC Layer (RED → GREEN)

- [ ] **2a. RED — Extend `tests/unit/extension/rpc-router.test.js`** with new assertions:
  - `router.onGetCustomAgents(handler)` registers without throwing
  - `router.route({ type: 'getCustomAgents' })` calls handler
  - `router.onSaveCustomAgent(handler)` + route test
  - `router.onDeleteCustomAgent(handler)` + route test
  - `router.sendCustomAgentsChanged([...])` sends `{ type: 'customAgentsChanged', agents: [...] }`
  - Run → FAIL (methods don't exist yet) ✅

- [ ] **2b. GREEN — Update `src/extension/rpc/ExtensionRpcRouter.ts`**:
  - Import new payload types from shared
  - Add `onGetCustomAgents`, `onSaveCustomAgent`, `onDeleteCustomAgent` receive handlers
  - Add `sendCustomAgentsChanged(agents: CustomAgentDefinition[])` send method
  - Run test → GREEN ✅

### Phase 3: chatViewProvider wiring

- [ ] **3. Update `src/chatViewProvider.ts`**:
  - Add `<div id="custom-agents-mount"></div>` between `session-toolbar-mount` and `<main>`
  - Instantiate `CustomAgentsService` (or receive via injection)
  - Register `router.onGetCustomAgents` → `service.getAll()` → `router.sendCustomAgentsChanged(agents)`
  - Register `router.onSaveCustomAgent` → `service.save(payload.agent)` → `router.sendCustomAgentsChanged(agents)`
  - Register `router.onDeleteCustomAgent` → `service.delete(payload.name)` → `router.sendCustomAgentsChanged(agents)`
  - *(No isolated unit test — covered by integration; verified manually)*

### Phase 4: SessionToolbar button (RED → GREEN)

- [ ] **4a. RED — Add to `tests/unit/components/SessionToolbar.test.js`**:
  ```javascript
  describe('Custom Agents Button', () => {
    it('should render agents button after viewPlanBtn', async () => { ... })
    it('should emit toggleAgentsPanel event when clicked', async () => { ... })
  })
  ```
  - Run → FAIL (button doesn't exist yet) ✅

- [ ] **4b. GREEN — Update `src/webview/app/components/SessionToolbar/SessionToolbar.js`**:
  - Add `<button id="agentsBtn" class="session-toolbar__btn--agents" title="Manage Custom Agents" aria-label="Manage custom agents">🤖</button>` after `viewPlanBtn` in `render()`
  - Wire click → `this.emit('toggleAgentsPanel')`
  - Run test → GREEN ✅

### Phase 5: CustomAgentsPanel component (RED → GREEN)

- [ ] **5a. RED — Create `tests/unit/components/CustomAgentsPanel.test.js`**

  **All tests import actual production code:**
  ```javascript
  import { CustomAgentsPanel } from '../../../src/webview/app/components/CustomAgentsPanel/CustomAgentsPanel.js';
  import { EventBus } from '../../../src/webview/app/state/EventBus.js';
  ```

  Test cases (MUST FAIL until component exists):

  **List view:**
  - Constructor renders hidden panel (has `.custom-agents-panel` with `display: none` or `max-height: 0`)
  - `show()` makes panel visible
  - `hide()` makes panel hidden
  - `toggle()` alternates visible/hidden
  - `setAgents([...])` renders agent rows
  - Built-in agents render ✏️ but NO 🗑 button
  - User agents render both ✏️ and 🗑 buttons
  - Clicking ✏️ transitions to details view (form visible)

  **Details view / form:**
  - Clicking `[+]` shows empty form
  - Form has fields: name, displayName, description, prompt, tools
  - Name field is readonly when editing existing agent
  - Save button emits `agents:save` on EventBus with form data
  - Cancel button returns to list view
  - Clicking 🗑 emits `agents:delete` on EventBus with agent name

  **EventBus wiring:**
  - On mount, emits `agents:request` to trigger initial data load
  - `setAgents()` re-renders without full component rebuild

  - Run → FAIL (file doesn't exist) ✅

- [ ] **5b. GREEN — Create `src/webview/app/components/CustomAgentsPanel/CustomAgentsPanel.js`**:
  - Constructor: `(container, eventBus)` — renders panel HTML, attaches listeners, emits `agents:request`
  - `show()` / `hide()` / `toggle()` — CSS `max-height` collapse (smooth animation)
  - `setAgents(agents)` — re-renders list view
  - List view: rows `[displayName] [description snippet] [✏️] [🗑?]`
  - Details view: form that slides in over list
  - Emits `agents:save`, `agents:delete`, `agents:request` via `eventBus.emit()`
  - Run tests → GREEN ✅

### Phase 6: main.js wiring

- [ ] **6. Update `src/webview/main.js`**:
  - Import `CustomAgentsPanel`
  - Mount on `document.getElementById('custom-agents-mount')`
  - Wire `sessionToolbar.on('toggleAgentsPanel', () => customAgentsPanel.toggle())`
  - Wire `eventBus.on('agents:request', () => rpc.getCustomAgents())`
  - Wire `eventBus.on('agents:save', (agent) => rpc.saveCustomAgent(agent))`
  - Wire `eventBus.on('agents:delete', (name) => rpc.deleteCustomAgent(name))`
  - Wire `rpc.onCustomAgentsChanged((data) => customAgentsPanel.setAgents(data.agents))`
  - Export `customAgentsPanel` in `__testExports`
  - *(Wire also: on `init`, call `rpc.getCustomAgents()` to populate panel on load)*

### Phase 7: SDK integration

- [ ] **7a. RED — Write `tests/unit/extension/custom-agents-session-integration.test.js`**:
  - Verifies that when `SDKSessionManager` creates a session, the `customAgents` array is passed
  - Uses the existing pattern: mock `createSession` to capture config, assert `config.customAgents` contains built-ins
  - Run → FAIL ✅

- [ ] **7b. GREEN — Update `src/sdkSessionManager.ts`**:
  - Import and instantiate `CustomAgentsService` (constructed with workspace config access)
  - In `createSessionWithModelFallback` call sites (lines 537, 556, 1213, 1241, 1594, 1737, 1759 in sdkSessionManager.ts), add `customAgents: this.customAgentsService.toSDKAgents()`
  - Run test → GREEN ✅

### Phase 8: Build wiring

- [ ] **8a. esbuild.js** — Add CustomAgentsPanel to dist:
  ```javascript
  const customAgentsPanelDistDir = path.join(componentsDistDir, 'CustomAgentsPanel');
  if (!fs.existsSync(customAgentsPanelDistDir)) {
    fs.mkdirSync(customAgentsPanelDistDir, { recursive: true });
  }
  fs.copyFileSync(
    path.join(__dirname, 'src', 'webview', 'app', 'components', 'CustomAgentsPanel', 'CustomAgentsPanel.js'),
    path.join(customAgentsPanelDistDir, 'CustomAgentsPanel.js')
  );
  ```

- [ ] **8b. package.json** — Add `copilotCLI.customAgents` setting:
  ```json
  "copilotCLI.customAgents": {
    "type": "array",
    "default": [],
    "description": "Custom agent definitions. Built-in agents (planner, implementer, reviewer) are always available.",
    "items": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "displayName": { "type": "string" },
        "description": { "type": "string" },
        "prompt": { "type": "string" },
        "tools": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["name", "prompt"]
    }
  }
  ```

- [ ] **8c. jsdom-component-setup.js** — Add `custom-agents-mount` to `PAGE_HTML`:
  ```javascript
  <div id="custom-agents-mount"></div>  // between session-toolbar-mount and messages-mount
  ```

### Phase 9: Version

- [ ] **9. package.json** — Bump version to `3.6.0`

---

## SDK `CustomAgentConfig` shape (reference)

```typescript
interface CustomAgentConfig {
  name: string;
  displayName?: string;
  description?: string;
  tools?: string[] | null;  // null/undefined = all tools
  prompt: string;
  mcpServers?: Record<string, MCPServerConfig>;
  infer?: boolean;
}
```

## Persistence

- User-defined agents: `copilotCLI.customAgents` workspace config (no `builtIn` field stored)
- Built-ins: constants in service, merged at `getAll()` runtime
- Override: user can edit a built-in's prompt/tools — same `name` key in user config wins
- Reset: user deletes the override entry, built-in defaults are restored

## RPC Flow

```
[Webview ready / init] → rpc.getCustomAgents()
  → extension: CustomAgentsService.getAll() → router.sendCustomAgentsChanged(agents)
  → webview: customAgentsPanel.setAgents(agents)

[User clicks Save] → eventBus('agents:save', agent) → rpc.saveCustomAgent(agent)
  → extension: service.save(agent) → router.sendCustomAgentsChanged(agents)
  → webview: customAgentsPanel.setAgents(agents)  [panel stays open, list refreshed]

[User clicks 🗑] → eventBus('agents:delete', name) → rpc.deleteCustomAgent(name)
  → extension: service.delete(name) → router.sendCustomAgentsChanged(agents)
  → webview: customAgentsPanel.setAgents(agents)
```

## UI Layout

```
[●]  Copilot CLI  [Session: ▼ abc123]  [+]  [📋]  [🤖]   ← SessionToolbar
┌─ Custom Agents ────────────────────────── [+] [✕] ┐    ← CustomAgentsPanel
│  Planner        Read-only exploration      ✏️      │    ← built-in: no 🗑
│  Implementer    Executes plan              ✏️      │
│  Reviewer       Runs tests                ✏️      │
│  My Agent       Custom prompt             ✏️ 🗑   │    ← user: has 🗑
└────────────────────────────────────────────────────┘
┌─ messages ─────────────────────────────────────────┐
│  ...chat messages...                               │
└────────────────────────────────────────────────────┘
```

Panel pushes chat down (no overlay). Zero `max-height` when closed.

## Test Checklist (All Must Pass Before Shipping)

- [ ] `custom-agents-service.test.js` — getAll/save/delete/toSDKAgents
- [ ] `rpc-router.test.js` — new send/receive methods
- [ ] `SessionToolbar.test.js` — 🤖 button renders + emits
- [ ] `CustomAgentsPanel.test.js` — list/form/events/builtIn guard
- [ ] `custom-agents-session-integration.test.js` — customAgents passed to createSession
- [ ] `npm test` — zero new failures vs baseline
- [ ] Manual: open panel → add agent → reload extension → agent persists ✅
- [ ] Manual: edit Planner prompt → save → can't delete Planner ✅

## Anti-Patterns to Avoid

- ❌ Testing mock service instead of compiled `out/extension/services/CustomAgentsService.js`
- ❌ Writing panel tests that call `eventBus.emit('agents:save', ...)` directly without clicking the DOM button
- ❌ Skipping the RED phase — every test file must be committed with a failing run before implementing
- ❌ Tests that pass immediately on first run

---

---

## Plan Review

**Reviewed:** 2026-06-18 20:03
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

- **Comprehensive TDD approach** — RED-GREEN-REFACTOR cycle is explicit and correctly ordered throughout all phases.
- **Clean architecture** — Proper separation: service layer, RPC layer, UI components each have clear responsibilities.
- **Phase sequencing** — Logical progression from type foundations through backend, RPC, UI, and integration.
- **Built-in agent design** — Three non-deletable built-ins with user-override-by-name-collision is sound.
- **Event-driven UI** — Correct use of EventBus for loose coupling between components.

### Issues

#### Critical (Must Address Before Implementation)

**Version number is obsolete**
- Section: Phase 9
- What's wrong: Plan proposes bumping to 3.6.0. Current version in package.json is 3.10.0.
- This is a retrospective review of already-implemented work.

**All sdkSessionManager.ts line numbers are wrong**
- Section: Phase 7b
- What's wrong: Plan claims createSessionWithModelFallback calls at lines 537, 556, 1213, 1241, 1594, 1737, 1759. Actual calls are at lines 608, 628, 1399, 1415, 1884, 2028, 2051. Lines 537/556 contain SDK initialization code.
- Why it matters: Anyone following these instructions literally would edit the wrong lines.

**Persistence mechanism doesn't match actual implementation**
- Section: Approach / Phase 1 / Phase 8b
- What's wrong: Plan specifies storing agents in copilotCLI.customAgents workspace settings. No such setting exists in package.json. Actual implementation uses AgentFileService with file-based storage in global directory.
- Why it matters: The entire Phase 1 service description is architecturally inconsistent with the real code.

**Integration test is missing**
- Section: Phase 7a
- What's wrong: tests/unit/extension/custom-agents-session-integration.test.js does not exist. Phase 7 implementation (passing toSDKAgents() to createSession) is complete — verified at 10 call sites — but the test that should guard it was never written.
- Why it matters: No test verifies customAgents are actually passed to SDK session creation. Regression risk.

#### Important (Should Address)

**AgentFileService never mentioned**
- Section: Phase 1
- What's wrong: Plan describes CustomAgentsService but never mentions AgentFileService, which CustomAgentsService.ts depends on as a constructor-injected dependency (line 46: private readonly agentFileService: AgentFileService).
- Fix: Document AgentFileService as a prerequisite or add it as Phase 0.5.

**Phase 8b task is incorrect**
- Section: Phase 8b
- What's wrong: "Add copilotCLI.customAgents setting schema to package.json" — setting doesn't exist and actual implementation doesn't use workspace config at all.
- Fix: Remove or replace with: "Confirm copilotCLI.customAgents is absent from package.json (agents stored in ~/.copilot/agents/ via AgentFileService)."

#### Minor (Consider)

**No CSS/styling mentioned for CustomAgentsPanel**
- Section: Phase 5
- Panel has documented layout behavior (collapsible, smooth animation, pushes chat down) but no CSS file is specified. The styling work would be undocumented.

**builtIn flag retention on override not tested**
- Section: Phase 1a
- Plan says "user wins on name collision" but doesn't verify the builtIn flag is preserved on the merged entry. Actual implementation at CustomAgentsService.ts line 69 explicitly preserves it: { ...fileAgent, builtIn: result[idx].builtIn }. A regression test would be valuable.

**No error handling requirements specified**
- No mention of validation, error states, or failure modes (invalid name, missing prompt, file write failure). Production-grade defensive programming is unspecified.

### Recommendations

1. **Label this as a retrospective** — "Implementation Review: 3.6.0" not a forward-looking plan. The code exists.
2. **Extract the real remaining work** — Write the missing Phase 7a integration test. That's the only open task.
3. **Document actual architecture** — AgentFileService + global file storage, not workspace settings.
4. **Drop line number references** — They go stale. Describe by function name instead.

### Assessment

**Implementable as written?** No

**Reasoning:** Wrong line numbers, wrong persistence mechanism, obsolete version, and the work is already done. The architecture is sound and the actual implementation is high quality — but this document would mislead anyone trying to implement from it. Real value: extract the missing integration test from Phase 7a and write it.
