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

## Plan Review

**Reviewed:** 2026-03-14 (auto)
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

1. **SDK alignment is solid.** The `CustomAgentDefinition` interface maps cleanly to the SDK's `CustomAgentConfig` (verified at `research/copilot-sdk/nodejs/src/types.ts`). The `toSDKAgents()` approach of stripping the `builtIn` field is correct.
2. **RPC flow is well-documented.** Clear sequence diagrams for all three flows (initial load, save, delete) with correct roundtrip pattern.
3. **Build system awareness.** Phase 8a explicitly addresses the esbuild.js copy requirement with exact code. Phase 8c covers JSDOM test setup.
4. **TDD structure is thorough.** Each phase follows RED-GREEN ordering with specific, verifiable test cases.
5. **Persistence model is clean.** Using workspace settings with built-in merge at runtime requires no migration.
6. **Task ordering respects dependencies.** Types -> service -> RPC -> wiring -> SDK integration -> build.

### Issues

#### Critical (Must Address Before Implementation)

**C1. Missing SDK spike — violates SDK-First Development rule.**
- Section: Phase 7 (SDK integration)
- CLAUDE.md states: "Before implementing any feature that touches the Copilot SDK... 1. Read the SDK source first. 2. Spike it." No spike exists in `planning/spikes/` for custom agents. The plan assumes `customAgents` passed at session creation "just works," but the SDK has additional features (`agent` field for auto-selection, `infer` flag) that may affect behavior.
- Fix: Add a pre-implementation spike in `planning/spikes/custom-agents/` that creates a session with `customAgents`, verifies agent registration, tests `session.rpc.agent.select()`, and documents observed behavior.

**C2. Component hierarchy needs explicit update.**
- Section: Phase 6 (main.js wiring)
- CLAUDE.md's component hierarchy shows: `main.js -> SessionToolbar, MessageDisplay, AcceptanceControls, InputArea`. The plan adds `CustomAgentsPanel` as a fifth top-level component but never acknowledges or updates the documented hierarchy.
- Fix: Add a task to update CLAUDE.md's component hierarchy to include CustomAgentsPanel.

**C3. No WebviewRpcClient methods defined.**
- Section: Phase 2 and Phase 6
- Phase 2 only updates `ExtensionRpcRouter.ts` (extension side). Phase 6 references `rpc.getCustomAgents()`, `rpc.saveCustomAgent()`, `rpc.deleteCustomAgent()`, and `rpc.onCustomAgentsChanged()` — but no task creates these methods in `src/webview/app/rpc/WebviewRpcClient.js`. This file has explicit, hand-written methods for every message type.
- Fix: Add a Phase 2c task to create these four methods in WebviewRpcClient.js.

#### Important (Should Address)

**I1. Agent selection/activation not addressed.** The SDK's `SessionConfig` has an `agent` field for activating an agent at session start. The plan registers agents but provides no way to select one. Without selection, agents are registered but never invoked. The plan should either add selection or explicitly defer it with a note.

**I2. Planner agent tool list references potentially nonexistent tool names.** The Planner's `tools` array includes `plan_bash_explore`, `update_work_plan`, `present_plan`, etc. These are custom tools from `getCustomTools()`. The plan does not verify they will be available to custom agents at the SDK level. The spike (C1) should validate this.

**I3. `save()` and `delete()` should be async.** `vscode.workspace.getConfiguration().update()` returns a `Thenable<void>`. The plan defines these as synchronous, which will cause TypeScript compilation issues when wired into async RPC handlers in Phase 3.

**I4. No error handling for save/delete failures.** Phase 3's RPC handlers call `service.save()` then unconditionally broadcast `sendCustomAgentsChanged`. If `config.update()` fails, the webview will show stale data. Wrap in try-catch and send an error notification on failure.

**I5. No validation of agent `name` field.** The `name` field is the SDK key. No validation is defined for empty strings, whitespace, special characters, or duplicates. Add validation in both the service (guard) and the form (UX).

**I6. CSS file for CustomAgentsPanel not mentioned.** Existing components have associated styles. The plan creates a JS file but does not clarify where styles live or whether a CSS file needs to be copied by esbuild.js.

**I7. BufferedEmitter consideration missing.** The `customAgentsChanged` response from the extension may arrive before the panel is mounted. The plan should document that this message routes through the existing BufferedEmitter mechanism.

#### Minor (Consider)

**M1. Emoji button may not render consistently.** Other toolbar buttons likely use codicons. Consider `$(hubot)` instead of a literal emoji for visual consistency.

**M2. `toSDKAgents()` should use destructuring.** Use `const { builtIn, ...sdkAgent } = agent` rather than property deletion for type safety.

**M3. Test file naming inconsistency.** `custom-agents-session-integration.test.js` lives in `tests/unit/extension/`, not an integration directory.

### Recommendations

1. **Add a spike phase first.** This is the highest-priority fix. A 30-minute spike validating `customAgents` behavior (agent registration, tool scoping, interaction with dual-session plan mode) could save hours of rework.
2. **Scope the feature explicitly.** State whether 3.6.0 is "agent management only" or includes "agent activation." The current plan is ambiguous.
3. **Add the WebviewRpcClient task.** Phase 6 references methods that no task creates. Implementation will stall without this.
4. **Make save/delete async.** This is not optional — VS Code's configuration API is async and TypeScript will not compile synchronous wrappers around `Thenable` return values.

### Assessment
**Implementable as written?** With fixes.

**Reasoning:** The plan has strong structural organization, good SDK alignment, and follows TDD conventions well. Three issues will block implementation if not addressed: the missing SDK spike violates a core project rule, the WebviewRpcClient methods are referenced but never created (Phase 6 will stall), and the synchronous service methods wrapping async VS Code APIs will cause compilation errors.
