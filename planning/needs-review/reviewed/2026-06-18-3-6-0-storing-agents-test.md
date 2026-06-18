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

---

## Plan Review

**Reviewed:** 2026-06-18 18:02
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

- **Clear problem statement** — VS Code-only limitation is well-articulated with concrete benefits (version control, ecosystem convention).
- **Sound architecture** — Correct separation: AgentFileService handles file I/O, CustomAgentsService delegates storage but preserves the public  contract. The rest of the system is isolated.
- **TDD workflow is explicit** — Phases 1 and 2 both start RED before GREEN, matching CLAUDE.md's strict TDD requirement.
- **Windows compatibility** — Addressed with specific guidance (os.homedir(), path.join(), test mocking).
- **File format well-specified** — Frontmatter structure, filename convention, and directory priority are all clearly documented.

### Issues

#### Critical (Must Address Before Implementation)

None.

#### Important (Should Address)

**Phase 0 is unnecessary**
- Section: Phase 0: Dependencies
- What's wrong: Both  and  are already installed in the project. The npm install would be a no-op.
- Why it matters: Creates confusion — implementer may assume something is being added when nothing is.
- Fix: Remove Phase 0 or replace with a verification note: "Dependencies already satisfied — skip to Phase 1."

**Phase 3 target may not exist**
- Section: Phase 3: Remove VS Code Config Registration
- What's wrong: Plan says "Remove  from  in package.json" but grep shows only  and  in the current package.json — no  entry.
- Why it matters: Implementer searches for a config key that doesn't exist, wastes time, or incorrectly removes an unrelated entry.
- Fix: Verify whether this key was ever added. If not, replace task with: "Verify  is absent from package.json (expected — it was never registered)."

**Integration test location unspecified**
- Section: Phase 4: Integration tests
- What's wrong: "Create real .md file in temp dir" doesn't specify where the test file should live.
- Fix: Specify path: 

**No data migration safety check**
- Section: Technical Considerations / "No data migration"
- What's wrong: Plan assumes no users have agents in  settings. If any pre-release users saved agents there, they'll silently lose them on upgrade.
- Fix: Add one-time migration: on first run, read  config; if non-empty, write each agent to  and clear the config key. This is a no-op for most users and prevents data loss if the assumption is wrong.

#### Minor (Consider)

**Version bump guidance missing**
- This adds a new feature (file-based storage, new directory, new file format). Per CLAUDE.md versioning rules, this is a **minor bump** (3.12.0), not a patch. Add to Technical Considerations.

**Manual test step "verify in panel" is vague**
- Section: Phase 5 manual verification
- Fix: "verify agent appears in the custom agents dropdown in the webview sidebar."

**Windows path test listed as manual when it should be automated**
- Section: Phase 5
- The Windows path handling is already in Phase 1's TDD test list (mock os.homedir()). Listing it again as "manual" in Phase 5 is redundant and confusing. Remove from Phase 5.

### Recommendations

- Confirm whether  was ever shipped in a released version. If yes, add migration. If no, remove Phase 3.
- Add version bump to Technical Considerations (3.12.0 minor).
- Verify esbuild.js requires no changes (correct — no new webview files added).

### Assessment

**Implementable as written?** Yes

**Reasoning:** The plan is architecturally sound, follows TDD discipline, and correctly isolates the storage change from the rest of the system. The Important issues (Phase 0 no-op, Phase 3 phantom config key, missing migration safety) are pre-implementation clarifications, not blockers. Fix the Phase 3 ambiguity and add migration before starting.
