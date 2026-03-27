# Pivot: File-Based Custom Agents (`~/.copilot/agents/`)

## Problem Statement

Custom agents are currently stored in VS Code `settings.json` via `vscode.workspace.getConfiguration('copilotCLI').customAgents`. This is VS Code-only — agents don't exist outside the extension, aren't version-controllable, and don't follow any ecosystem convention. This leave the users tethered to our extension and therefore less likely to adopt.

**Goal:** Pivot to file-based storage using `.md` files with YAML frontmatter, stored in:
- `~/.copilot/agents/` — global user scope (all workspaces)
- `<workspace>/.copilot/agents/` — project scope (per-repo, committable)

Format mirrors Claude Code's subagent convention (frontmatter + markdown body = system prompt), stored in Copilot's own namespace. Copilot already scans for claude skills and without a public statement otherwise, we'll adopt claude's convention for agents. This could change in the future but we'll cross that bridge when copilot releases a public api / format for custom agents in YAML format, along with the appropriate storage location.

## Approach

1. Add a new `AgentFileService` responsible for all file I/O
2. Pivot `CustomAgentsService` to delegate to `AgentFileService` instead of VS Code config
3. The rest of the system (`sdkSessionManager`, RPC layer, webview) stays unchanged — `toSDKAgents()` contract is preserved
4. No data migration — custom agents have not shipped to users yet
5. Add `js-yaml` as an explicit dependency (already transitively present)

### File Format

```markdown
---
name: my-agent
description: What this agent does and when to use it
displayName: My Agent
model: haiku
tools: view, grep, glob, bash
---

You are a specialized agent. Your job is to...
```

- Frontmatter: `name` (required), `description`, `displayName`, `model`, `tools` (comma-separated string OR YAML array)
- Body: the system prompt (markdown, passed as `prompt` to SDK)
- Filename: `<name>.md` (slug matches frontmatter `name`)
- `builtIn` is never written to files (built-ins remain hardcoded in TypeScript)

### Directory Priority

Project-scoped agents (`.copilot/agents/`) win over global (`~/.copilot/agents/`) on name collision — same priority model as Claude Code.

### Windows Compatibility

- All paths use `path.join()` and `os.homedir()` — never string concatenation, never hardcoded separators
- `os.homedir()` returns `C:\Users\username` on Windows; `path.join()` handles separators correctly
- `vscode.workspace.workspaceFolders[0].uri.fsPath` for workspace root (already cross-platform in VS Code)
- Directory creation uses `fs.mkdirSync(..., { recursive: true })` — works on both platforms
- Tests must mock `os.homedir()` to return a Windows-style path and verify path construction

---

## Tasks

### Phase 0: Dependencies

- [ ] Add `js-yaml` to `dependencies` in `package.json`
- [ ] Add `@types/js-yaml` to `devDependencies` in `package.json`
- [ ] Run `npm install` to lock versions
- [ ] Verify `js-yaml` imports compile cleanly in TypeScript

### Phase 1: AgentFileService — TDD RED first

Write tests BEFORE implementation. Each test must fail against a non-existent/empty implementation.

**Test file:** `tests/unit/extension/services/agent-file-service.test.js`

- [ ] **RED** — `parseAgentFile()`: test parses valid frontmatter + body into `CustomAgentDefinition`
- [ ] **RED** — `parseAgentFile()`: test returns error when frontmatter `name` is missing
- [ ] **RED** — `parseAgentFile()`: test parses `tools` as comma-separated string → string array
- [ ] **RED** — `parseAgentFile()`: test parses `tools` as YAML array → string array
- [ ] **RED** — `parseAgentFile()`: test handles missing optional fields gracefully (no description, no model)
- [ ] **RED** — `parseAgentFile()`: test body becomes `prompt`; leading/trailing whitespace stripped
- [ ] **RED** — `getAgentDirs()` on Unix: returns `[~/.copilot/agents, <workspace>/.copilot/agents]` with correct separators
- [ ] **RED** — `getAgentDirs()` on Windows: mock `os.homedir()` → `C:\Users\Test`; verify `path.join()` produces correct Windows paths
- [ ] **RED** — `getAgentDirs()` with no workspace: returns only global dir
- [ ] **RED** — `scanDirectory()`: returns empty array when dir does not exist (no throw)
- [ ] **RED** — `scanDirectory()`: reads `.md` files, skips non-`.md` files
- [ ] **RED** — `scanDirectory()`: skips files with parse errors (logs warning, continues)
- [ ] **RED** — `getAll()`: merges global + project dirs; project agent wins on name collision
- [ ] **RED** — `getAll()`: returns global-only when no workspace provided
- [ ] **RED** — `serializeAgent()`: produces valid frontmatter + body from `CustomAgentDefinition`
- [ ] **RED** — `serializeAgent()`: `tools` array serialized as comma-separated string
- [ ] **RED** — `serializeAgent()`: omits undefined optional fields from frontmatter
- [ ] **RED** — `save(agent, 'global')`: writes file to `~/.copilot/agents/<name>.md`; creates dir if not exists
- [ ] **RED** — `save(agent, 'project', workspaceRoot)`: writes to `<workspace>/.copilot/agents/<name>.md`
- [ ] **RED** — `save()`: throws when `workspaceRoot` is undefined and scope is `'project'`
- [ ] **RED** — `delete(name, workspaceRoot)`: removes file from global dir if present
- [ ] **RED** — `delete(name, workspaceRoot)`: removes file from project dir if present
- [ ] **RED** — `delete()`: does not throw if file does not exist (idempotent)

### Phase 1: AgentFileService — GREEN

- [ ] Create `src/extension/services/AgentFileService.ts`
- [ ] Implement `parseAgentFile(filePath: string): ParseResult`
  - Read file with `fs.readFileSync`
  - Split on `---` delimiters to extract frontmatter and body
  - Parse frontmatter with `js-yaml`
  - Normalize `tools`: string → split on comma+trim; array → as-is; null/undefined → null
  - Return `{ kind: 'success', agent }` or `{ kind: 'error', message }`
- [ ] Implement `getAgentDirs(workspaceRoot?: string): string[]`
  - Always include `path.join(os.homedir(), '.copilot', 'agents')`
  - If `workspaceRoot` provided, also include `path.join(workspaceRoot, '.copilot', 'agents')`
- [ ] Implement `scanDirectory(dir: string): CustomAgentDefinition[]`
  - Return `[]` if dir does not exist
  - `fs.readdirSync(dir)`, filter `*.md`, call `parseAgentFile` on each
  - Log warning and skip on parse error
- [ ] Implement `getAll(workspaceRoot?: string): CustomAgentDefinition[]`
  - Scan global dir, then project dir
  - Merge: project entry wins on name collision
- [ ] Implement `serializeAgent(agent: CustomAgentDefinition): string`
  - Build frontmatter object (omit undefined fields, omit `builtIn`)
  - `js-yaml.dump()` for frontmatter block
  - Return `---\n${frontmatter}---\n\n${prompt}`
- [ ] Implement `save(agent, scope, workspaceRoot?)`: resolve dir, `mkdirSync(recursive)`, write file
- [ ] Implement `delete(name, workspaceRoot?)`: resolve both dirs, `unlinkSync` if file exists (no-throw)
- [ ] Run Phase 1 tests — all GREEN

### Phase 2: CustomAgentsService — TDD RED first

Replace VS Code config usage with `AgentFileService` delegation.

- [ ] **RED** — Update existing `custom-agents-service.test.js`:
  - Remove all VS Code config mocks
  - Inject mock `AgentFileService` (constructor injection or module mock)
  - `getAll()` calls `agentFileService.getAll()` and merges with built-ins
  - `save()` calls `agentFileService.save()` with correct scope and workspaceRoot
  - `delete()` still throws on built-in names; calls `agentFileService.delete()` for user agents
  - `toSDKAgents()` still strips `builtIn` and returns all agents

### Phase 2: CustomAgentsService — GREEN

- [ ] Update `CustomAgentsService.ts`:
  - Accept `AgentFileService` via constructor (or create internally)
  - Remove all `vscode.workspace.getConfiguration` usage from `save()` and `delete()`
  - `getAll()` = built-ins merged with `agentFileService.getAll(workspaceRoot)`
  - `save(agent)` = validate name/prompt (keep existing validation), call `agentFileService.save(agent, scope, workspaceRoot)`
  - Determine `workspaceRoot` from `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath`
  - `delete(name)` = guard built-ins, call `agentFileService.delete(name, workspaceRoot)`
  - `toSDKAgents()` unchanged
- [ ] Run Phase 2 tests — all GREEN

### Phase 3: Remove VS Code Config Registration

- [ ] Remove `copilotCLI.customAgents` from `contributes.configuration` in `package.json`
- [ ] Verify no other code references `copilotCLI.customAgents`
- [ ] Update `README.md` / any documentation that mentions saving agents in settings

### Phase 4: Integration tests — RED then GREEN

- [ ] **RED** — Write integration test: create a real `.md` file in a temp dir → `AgentFileService.getAll()` returns it → `CustomAgentsService.getAll()` includes it alongside built-ins → `toSDKAgents()` passes it through without `builtIn`
- [ ] **RED** — Write integration test: `save()` writes a readable file → `getAll()` round-trips it correctly
- [ ] **GREEN** — Verify both tests pass end-to-end

### Phase 5: Build & Verify

- [ ] `npm run compile` — no TypeScript errors
- [ ] `npm test` — all existing tests pass; new tests pass
- [ ] `./test-extension.sh` — install extension
- [ ] Manually create `~/.copilot/agents/test-agent.md` with valid frontmatter
- [ ] Open extension → verify agent appears in panel
- [ ] Create agent via panel UI → verify `.md` file written to `~/.copilot/agents/`
- [ ] Delete agent via panel UI → verify file removed
- [ ] Verify on Windows path: add a test that mocks `os.homedir()` to `C:\Users\TestUser` and asserts `path.join` output is `C:\Users\TestUser\.copilot\agents`

---

## Technical Considerations

### No `gray-matter` needed
`js-yaml` is already in the dependency tree. Manual frontmatter splitting (`split(/^---$/m)`) + `js-yaml.load()` is sufficient and avoids adding a new package.

### `scope` parameter for `save()`
Default to `'global'` unless user explicitly saves project-scoped. The UI can offer a scope dropdown later — for the initial pivot, default to global to match current behavior (VS Code global config was `ConfigurationTarget.Global`).

### `workspaceRoot` may be undefined
`vscode.workspace.workspaceFolders` can be undefined (no folder open). Guard everywhere — fall back to global-only. Already a pattern in the codebase (`sessionUtils.ts`).

### File watching (future)
Not in scope for this pivot. If a user manually edits a file, they reload the window. `AgentFileService.getAll()` is called fresh on each session create (via `sdkSessionManager.ts`), so file changes are picked up on next session.

### sdkSessionManager.ts — no changes needed
`customAgentsService.toSDKAgents()` contract is unchanged. All 10+ call sites continue to work.

### RPC layer — no changes needed
`getCustomAgents`, `saveCustomAgent`, `deleteCustomAgent` messages remain. `CustomAgentsService` is the only thing that changes under the hood.

### Existing tests for CustomAgentsService
All existing tests test VS Code config behavior. They will need to be rewritten — not just updated. The storage contract changed completely. Delete and replace, don't patch.

---

## Plan Review

**Reviewed:** 2026-03-15 (auto)
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

1. **Clean separation of concerns.** `AgentFileService` as a pure I/O layer beneath `CustomAgentsService` is sound — keeps file parsing testable in isolation.
2. **Correct "no migration" window.** Custom agents haven't shipped to users, making this the right time to pivot without migration code.
3. **`toSDKAgents()` contract preserved.** All 10+ call sites in `sdkSessionManager.ts` go through `toSDKAgents()`, and that contract is unchanged. Single most important architectural invariant.
4. **Thorough TDD test list.** RED-then-GREEN breakdown covers parsing, serialization, directory priority, error handling, and idempotent delete.
5. **Windows compatibility called out explicitly.** `path.join()` and `os.homedir()` requirements documented with specific Windows mock test.
6. **Pragmatic file format choice.** YAML frontmatter + markdown body is well-understood; avoiding `gray-matter` keeps dependency surface small.

### Issues

#### Critical (Must Address Before Implementation)

1. **Two independent `CustomAgentsService` instances exist — plan doesn't address the `sdkSessionManager.ts` instance.** Both `chatViewProvider.ts` (line 38) and `sdkSessionManager.ts` (line 350) create their own `new CustomAgentsService()`. The plan says "sdkSessionManager.ts — no changes needed." This is technically true (both will independently scan the filesystem via `getAll()`), but should be explicitly documented as intentional so the implementer doesn't accidentally introduce a shared singleton with stale state.

2. **`save()` signature change not propagated to RPC handler or webview.** The plan adds a `scope` parameter to `save(agent, scope, workspaceRoot)` on `AgentFileService`, but `SaveCustomAgentPayload` only carries `{ agent }`. Phase 2 says `CustomAgentsService.save(agent)` delegates to `agentFileService.save(agent, scope, workspaceRoot)` but scope isn't passed from the caller. Plan should explicitly state that `CustomAgentsService.save()` keeps the existing `save(agent)` signature and internally determines scope (defaulting to `'global'`).

3. **`CustomAgentDefinition` type needs a `scope`/`source` field for round-tripping.** Once agents are merged in `getAll()`, the delete operation cannot know which directory to remove from. If a global and project agent share a name (project wins), deleting by name removes the project file but leaves the global file exposed — not what the user intended. Either: (a) add `scope?: 'global' | 'project'` to `CustomAgentDefinition`, or (b) document that `delete()` removes from both directories and explain why.

#### Important (Should Address)

4. **`js-yaml` "already transitively present" is misleading.** It's a transitive dependency of `eslint` and `mocha` (devDependencies), not production deps. The esbuild bundle may fail to resolve it without Phase 0. Reword to: "available in lockfile via devDependencies; adding to `dependencies` is required for the production bundle."

5. **Frontmatter parsing with `split(/^---$/m)` is fragile.** If the markdown body contains a `---` horizontal rule, the split breaks. Specify: "Match `---` at byte 0, then find the next `---` on its own line. Everything between is frontmatter YAML. Everything after the second `---` is body."

6. **`delete()` semantics for name collisions are underspecified.** The tests say "removes from global dir if present" and "removes from project dir if present" — implying a single call removes from both. This could surprise users who want to delete a project override while keeping the global agent. Clarify intended behavior.

7. **No `model` field on `CustomAgentDefinition`.** The file format includes `model` in frontmatter, but `CustomAgentDefinition` in `models.ts` has no `model` property. Either extend the type now or explicitly defer with a note.

#### Minor (Consider)

8. **Filename vs frontmatter `name` mismatch.** Plan doesn't specify behavior when `<name>.md` filename disagrees with frontmatter `name`. Consider making filename authoritative.
9. **Webview `CustomAgentsPanel` has no scope selector.** Acknowledged in plan but worth listing as explicit "not in scope" rather than a parenthetical.
10. **Removing `copilotCLI.customAgents` from `package.json` silently loses any existing config.** Since agents haven't shipped, this is fine, but document it as a conscious decision.

### Recommendations

1. Clarify `CustomAgentsService.save(agent)` signature is unchanged; scope defaults to `'global'` internally.
2. Add `model` to `CustomAgentDefinition` in `models.ts`, or explicitly defer.
3. Fix frontmatter parser spec to handle `---` horizontal rules in body.
4. Decide and document delete semantics for name-collision scenarios.
5. Reword `js-yaml` transitive claim to clarify production bundle requirement.
6. Document that both `CustomAgentsService` instances will independently scan the filesystem (intentional, not a bug).

### Assessment
**Implementable as written?** With fixes
**Reasoning:** The core architecture (AgentFileService under CustomAgentsService, preserved toSDKAgents contract, TDD phases) is sound and well-scoped. However, the ambiguity around `save()` signature propagation, missing `model` field on the shared type, and underspecified delete semantics for name collisions need resolution before implementation, or the implementer will hit blocking design questions mid-flight.
