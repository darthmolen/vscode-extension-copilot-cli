# Two fixes: cross-project session resume, and plugin skill discovery

Two independent bugs. Part 1 is fully diagnosed with a verified root cause. Part 2 has two verified defects in our resolver, but the causal link to the symptom you saw still needs a spike — that spike is step one, not an afterthought.

---

# Part 1 — Chat resumes a session belonging to a different project

## Context

Opening VS Code in project A can load project B's conversation into the chat panel. This is not a display glitch — the extension actually resumes the foreign session, so the transcript, the session id, and the CLI session all belong to the wrong project.

The cause is a deliberate fallback in session selection. When the workspace-folder filter finds no sessions for the folder you just opened, the code returns the globally most-recent session instead of nothing:

```ts
// src/extension/services/SessionService.ts:131-132
// Fallback to global most recent
return sorted[0].id;
```

This directly contradicts the contract the setting advertises in [package.json:159](package.json#L159) — *"only shows sessions created in the current folder"*.

**Reproduced against real state on this machine.** Only two sessions under `~/.copilot/session-state/` have an `events.jsonl` (the requirement to be listed at all): one in `c:\dev\jesus-the-christ-scriptures` and one in `c:\dev\learning-python-gamification`. Neither belongs to this repo, so opening `vscode-extension-copilot-cli` filters to zero matches and falls through to `d3ea63df-…` — the learning-python-gamification session.

This also explains why the symptom is specific to the chat area: the **dropdown** filters correctly and has no fallback ([extension.ts:902-905](src/extension.ts#L902-L905)), so it can legitimately show a list that does not contain the session the chat just loaded.

Two independent code paths reach the bad fallback, and both must be covered:

1. [extension.ts:525](src/extension.ts#L525) — `determineSessionToResume`, whose result is fed to `loadSessionHistory` at [extension.ts:326](src/extension.ts#L326). This is what visibly paints the foreign transcript.
2. [sdkSessionManager.ts:378](src/sdkSessionManager.ts#L378) — `loadLastSessionId()`. When path 1 returns `null`, `startCLISession` still passes `resumeLastSession: true` with `specificSessionId: undefined` ([extension.ts:554-560](src/extension.ts#L554-L560)), so the manager re-picks a session on its own and re-introduces the bug.

Both call the same `SessionService.getMostRecentSession`, so one fix covers both — but the second path is the reason a fix at the `extension.ts` layer alone would not work.

### Secondary defects that make the filter miss (and thus trigger the fallback)

- **Case-sensitive path comparison.** `normalizePath` ([SessionService.ts:7-13](src/extension/services/SessionService.ts#L7-L13)) is `path.normalize` plus a trailing-separator strip, with no case folding. Windows drive-letter case is genuinely inconsistent in this data — a single `workspace.yaml` on this machine contains `cwd: c:\dev\…` (lowercase) next to `git_root: C:\dev\…` (uppercase). Any mismatch filters everything out and hands control to the fallback.
- **Fragile cwd extraction.** `getSessionCwd` ([SessionService.ts:31-57](src/extension/services/SessionService.ts#L31-L57)) reads only the first 2048 bytes of `events.jsonl` and requires line 1 to be `session.start`. A longer first line truncates, `JSON.parse` throws, the error is swallowed, and the session is treated as having no cwd — which excludes it from the filter and, again, triggers the fallback. Meanwhile `workspace.yaml` holds the same value in ~300 bytes and is always present.

### Decisions taken

- No folder match → **start a fresh session** in this workspace. Never show another project's history.
- Matching is **exact cwd, case-insensitive on Windows**.
- cwd comes from **`workspace.yaml` first, `events.jsonl` as fallback**.

### Why not the SDK's `listSessions`

The SDK does expose `client.listSessions({ workingDirectory })` returning `SessionMetadata.context.workingDirectory`, sorted newest-first. It is not usable here: session selection runs *before* `CopilotClient` is constructed ([sdkSessionManager.ts:498](src/sdkSessionManager.ts#L498)), and its wire filter is an exact `cwd` match anyway, so it would not solve the case problem. Keep the filesystem approach.

One SDK fact worth preserving: `resumeSession` accepts a `workingDirectory` that **relocates** the session's cwd if supplied. The current code correctly omits it ([sdkSessionManager.ts:535-551](src/sdkSessionManager.ts#L535-L551)). Do not add it.

## Changes

All production changes are in one file: [src/extension/services/SessionService.ts](src/extension/services/SessionService.ts).

### 1. Remove the global fallback — `getMostRecentSession` ([:114-133](src/extension/services/SessionService.ts#L114-L133))

When `filterByFolder` is true and no folder-specific session exists, return `null`. Callers already handle `null` as "start a new session" ([extension.ts:526-532](src/extension.ts#L526-L532), [sdkSessionManager.ts:380-385](src/sdkSessionManager.ts#L380-L385)), so no caller changes are needed. Keep the `filterByFolder === false` branch returning the global most-recent — that is the setting's opt-out and remains correct.

Update the doc comment, which currently documents the fallback.

### 2. Case-insensitive path comparison — `normalizePath` ([:7-13](src/extension/services/SessionService.ts#L7-L13))

Lower-case the normalized path when `process.platform === 'win32'`. Leave POSIX comparison case-sensitive. This is the correct place — it is the single helper `filterSessionsByFolder` uses.

### 3. Prefer `workspace.yaml` for cwd — `getSessionCwd` ([:31-57](src/extension/services/SessionService.ts#L31-L57))

Read `workspace.yaml` and parse `cwd:` with a line-anchored regex first; fall back to the existing `events.jsonl` reader when the file is missing or has no `cwd`. Reuse the regex style already established in `ensureSessionName` ([:162](src/extension/services/SessionService.ts#L162)), which parses `created_at` from the same file — no YAML dependency needed. Keep the existing swallow-and-return-`undefined` error behavior.

Deliberately **not** changing: `getAllSessions` still requires `events.jsonl` ([:84](src/extension/services/SessionService.ts#L84)). That is the "has real history" test and relaxing it would surface empty sessions in the dropdown — out of scope.

### 4. Delete the dead duplicate — [src/sessionUtils.ts](src/sessionUtils.ts)

Carries a byte-for-byte copy of the same bug at [:166-167](src/sessionUtils.ts#L166-L167), plus its own `getAllSessions` and `filterSessionsByFolder`. Nothing in `src/` imports it — verified by grep. It is a landmine that will silently reintroduce this bug if anyone wires it up. Its only consumer is an integration test (see below).

### 5. Optional guard — [extension.ts:320-329](src/extension.ts#L320-L329)

When `determineSessionToResume` returns `null`, `loadSessionHistory` is skipped and `backendState.clearMessages()` never runs. On a cold start the store is already empty, so this is not the bug — but an explicit clear on the no-session branch makes the "fresh session means empty chat" guarantee hold regardless of how activation was reached.

## Tests

Per CLAUDE.md: write the failing test first, and evaluate broken tests rather than restoring behavior to satisfy them.

### [tests/unit/extension/session-service.test.js](tests/unit/extension/session-service.test.js)

- **Rewrite** `'falls back to global most recent when no folder sessions exist'` ([:292](tests/unit/extension/session-service.test.js#L292)). This test asserts the exact behavior being removed — it is case 2 in CLAUDE.md's guidance (intentionally removed behavior). Retarget it to assert `null`, renamed to something like *"returns null when no folder sessions exist"*. This is the RED test for the whole fix.
- **Add**: `filterByFolder: false` still returns the global most-recent (guards against over-correcting).
- **Add**: Windows drive-letter case mismatch still matches — `c:\dev\proj` session vs `C:\dev\proj` workspace. Gate on `process.platform === 'win32'`, since the assertion is platform-specific by design.
- **Add**: cwd is read from `workspace.yaml` when `events.jsonl`'s first line is unparseable or oversized. The existing `createTempSessionDir` helper writes `events.jsonl`; it will need to also write a `workspace.yaml`.

### [tests/integration/session/session-resume.test.js](tests/integration/session/session-resume.test.js)

Requires `out/sessionUtils` at [:166](tests/integration/session/session-resume.test.js#L166) and depends on the fallback — it passes `'/test/workspace'`, which matches nothing, and expects a session id back ([:179-181](tests/integration/session/session-resume.test.js#L179-L181), [:198-201](tests/integration/session/session-resume.test.js#L198-L201)). Migrate both cases to `SessionService` and create the fixture sessions with a cwd that actually matches the folder passed in, so they assert real folder-scoped selection. The `getAllSessions` cases at [:184-196](tests/integration/session/session-resume.test.js#L184-L196) migrate as-is.

### [tests/e2e/session/webview-lifecycle-integration.test.js](tests/e2e/session/webview-lifecycle-integration.test.js)

References the same helpers — check and update if it asserts fallback behavior.

## Verification

1. `npm run compile` — type-check, lint, bundle.
2. `npm test` — full suite. `main.js size constraint` is a known baseline failure and not a regression.
3. Manual, which is how the bug was found and the only way to confirm the user-visible fix:
   - `./test-extension.sh`, then Developer: Reload Window.
   - Open `c:\dev\vscode-extension-copilot-cli` (which has no session with `events.jsonl`). **Expected:** empty chat, new session. **Before the fix:** the `learning-python-gamification` transcript.
   - Check the "Copilot CLI" Output Channel for `No previous sessions found, will start new session` rather than `Will resume session: d3ea63df-…`.
   - Send a message to create a session here, reload, and confirm *that* session resumes — proving the fix did not simply disable resume.
   - Open `c:\dev\learning-python-gamification` and confirm its own session still resumes correctly.
   - Set `copilotCLI.filterSessionsByFolder` to `false` and confirm the global most-recent behavior still works as the documented opt-out.

---

# Part 2 — Plugin skills not reaching the agent

## Context

You asked the agent about a skill and it could not find one until it fell back to a glob search.

### Correcting the premise first

**The plugin cache *is* being scanned.** [SkillDirectoriesService.ts:57-59](src/extension/services/SkillDirectoriesService.ts#L57-L59) walks `~/.claude/plugins/cache/**` to depth 5, and the skill dirs sit at depth 3 (`cache/<marketplace>/<plugin>/<version>/skills`). I ran the resolver's exact algorithm against your real home directory: it returns **13 directories**, all of them plugin-cache paths.

`~/.claude/skills` is not among them — because that directory does not exist on your machine. So "it only looked in claude skills directly" cannot be what the loader did. That matters: the fix is not "add the plugin cache", it is already there.

I also ruled out the obvious mechanical explanations:

- The SDK config key is correct — `skillDirectories?: string[]` on `SessionConfigBase` (`types.d.ts:1988`).
- It is forwarded on **both** wire paths — `session.create` (`index.js:9849`) and `session.resume` (`index.js:10053`). My first read suggested resume dropped it; that was a truncated read and is wrong.
- The resolved CLI is current. The managed bundle at `globalStorage/darthmolen.copilot-cli-extension/cli/_1.0.67` holds CLI **1.0.80**, matching the system install.
- Skill directory structure is valid — `<skills>/<name>/SKILL.md` with `name` + `description` frontmatter.
- Both create and resume inject `skillDirectories` in our code ([sdkSessionManager.ts:413](src/sdkSessionManager.ts#L413), [:2175](src/sdkSessionManager.ts#L2175)), cached via `resolveSkillDirectories()` ([:1102-1109](src/sdkSessionManager.ts#L1102-L1109)).

### Two verified defects in what we pass

Comparing the resolver's 13 directories against `~/.claude/plugins/installed_plugins.json` (the authoritative manifest, schema `version: 2`, keyed `<plugin>@<marketplace>` with an explicit `installPath`), two entries should not be there:

1. `…\ai-plugins-and-skills\1.0.0\skills` — **stale version.** Only `1.1.0` is installed. We pass both, and they collide on **17 skill names** (`csharp-quality-developer`, `plan-intake-review`, `code-review-apply`, `sql-query`, …). Two directories claiming the same skill names is exactly the kind of input that makes a loader drop or mis-resolve a set.
2. `…\ai-plugins-and-skills-ai-standards\curriculum\1.0.0\skills` — **not installed at all.** No manifest entry; an uninstalled leftover in the cache.

The blind directory walk cannot tell an installed plugin from a stale or uninstalled one, because the cache retains every version ever fetched.

### Why *not* to add `~/.claude/plugins/marketplaces/`

Claude Code now also populates `~/.claude/plugins/marketplaces/`, which contains 21 more `skills/` directories (`claude-plugins-official/plugins/*/skills`, etc.). It is tempting to add it — **don't.** That tree is the cloned marketplace *source*, listing plugins you have not installed. `installed_plugins.json` points exclusively into `cache/`. Scanning `marketplaces/` would flood the session with dozens of uninstalled plugins' skills and make the collision problem far worse.

## Step 1 — Spike (do this before writing any fix)

CLAUDE.md's SDK-First rule applies: the link between "we pass 13 dirs including a 17-name collision" and "the agent cannot see skills" is a hypothesis, not a proven cause. Prove it in `planning/spikes/skill-discovery/` before touching production code.

Create a session directly against the SDK — no extension, no webview — and ask the CLI what it loaded:

1. `createSession({ skillDirectories: [...all 13...] })`, then ask the agent to list its available skills. Reproduce the failure outside the extension.
2. Repeat with the 11 manifest-derived directories (stale + uninstalled removed). If skills appear, the collision is confirmed as the cause.
3. Repeat with a single clean directory to establish the baseline.
4. Also probe `enableSkills` (`types.d.ts:2084`): *"When false, no skills are loaded regardless of `skillDirectories`."* We never set it, so it takes the runtime default. `configDefaultsForMode` (`index.js:9629`) forces it `false` only in `mode: "empty"`, which we do not use — but confirm the default is actually `true` rather than assuming it.

The spike decides whether the fix below is sufficient or merely necessary.

## Step 2 — Manifest-driven resolution

In [SkillDirectoriesService.ts](src/extension/services/SkillDirectoriesService.ts), replace the blind cache walk with manifest-driven resolution:

- Read `~/.claude/plugins/installed_plugins.json`. For each entry in `plugins`, take each element's `installPath` and include `<installPath>/skills` when it exists.
- **Keep `findSkillDirsIn` as a fallback** for a missing, unparseable, or unrecognized-schema manifest (older Claude Code installs, or a future schema bump). Guard on `version === 2` and fall back otherwise — do not let a schema change silently yield zero skills.
- Leave the `~/.claude/skills`, `~/.agents/skills`, and user-configured `additionalSkillDirectories` candidates exactly as they are, along with the existing existence-filter and dedupe ([:64-72](src/extension/services/SkillDirectoriesService.ts#L64-L72)).

This is also future-proof: if Claude Code later installs into `marketplaces/`, the manifest's `installPath` follows automatically.

Add a log line recording the resolved directory count and source (manifest vs. fallback walk). Skill resolution is currently silent, which is why this went unnoticed — with `skillDirectoriesCache` computed once per manager ([:1100](src/sdkSessionManager.ts#L1100)), there is exactly one line to emit per session.

### Tests

Existing coverage is in `tests/unit/extension/` for this service — the `homeDir` parameter ([:50](src/extension/services/SkillDirectoriesService.ts#L50)) is already injectable, so all of this is testable against a temp fixture with no new seams:

- Manifest with two versions of one plugin → only the `installPath` version is returned (RED test for defect 1).
- Manifest omitting a cached plugin → that plugin is excluded (defect 2).
- Missing manifest → falls back to the directory walk, preserving today's behavior.
- Malformed JSON / unexpected `version` → falls back rather than returning empty.
- `marketplaces/` present on disk → still not scanned.

## Verification

Beyond the unit tests, this needs a real end-to-end check, since the symptom was behavioral:

1. `./test-extension.sh`, reload window.
2. Confirm the Output Channel logs 11 skill directories (not 13), manifest-sourced.
3. In the chat, ask the agent to use a skill that lives in a plugin — one of the colliding names such as `plan-intake-review` is the sharpest test. It should invoke the skill directly, with no glob search.
4. Verify on both a fresh session and a resumed one, since `skillDirectories` travels on both wire paths.

---

## Versioning

Both are bug fixes → patch, **3.8.1**. Neither adds capability or UI. If the spike shows Part 2 needs a behavioral change beyond correcting the directory list, re-evaluate — per CLAUDE.md, when in doubt bump minor.

## Sequencing

Part 1 is ready to implement now. Part 2 should not have code written until the spike in Step 1 identifies the mechanism. They touch disjoint files, so they can proceed independently.

## Note

CLAUDE.md's SDK-First section points at `research/copilot-sdk/nodejs/src/` for SDK source. That directory does not exist in the repo or in git history, and `node_modules/` is not currently installed. The only SDK on this machine is the one bundled with the CLI at `%LOCALAPPDATA%\copilot\pkg\win32-x64\1.0.80\copilot-sdk\` (ships `.d.ts` plus a bundled `index.js`) — that is what the findings above were read from. Worth correcting the path in CLAUDE.md separately; not part of either fix.

---

## Plan Review

**Reviewed:** 2026-09-01 16:50
**Reviewer:** Claude Code (plan-review-intake)

### Strengths
- Root causes are verified against the codebase and live filesystem state.
- The plan correctly avoids the wrong fixes and keeps the scope tight.
- Part 2 appropriately gates implementation behind a spike instead of assuming causation.

### Issues

#### Critical (Must Address Before Implementation)
None.

#### Important (Should Address)
- The plan does not address `-plan` sibling session directories, which will now become eligible folder matches once the fallback is removed and case-insensitive matching/workspace.yaml parsing are fixed. That can cause the plan session to be resumed instead of the work session.
- Deleting `src/sessionUtils.ts` needs to land atomically with the test migrations that still import it, or the test build will break mid-change.

#### Minor (Consider)
- The `workspace.yaml` `cwd:` parsing test should assert the full end-to-end folder match, not just successful parsing.
- The manual verification counts in Part 2 are machine-specific and should stay manual only.

### Recommendations
- Explicitly decide how `-plan` sessions should be treated in folder-scoped resume selection.
- Treat the `sessionUtils.ts` deletion and both test migrations as a single change set with a compile-tests gate.
- Keep the workspace.yaml test focused on matching behavior, not just extraction.

### Assessment
**Implementable as written?** With fixes
**Reasoning:** The plan is solid and well-supported, but it needs one explicit policy decision for `-plan` sibling sessions and a tighter atomic plan for removing `sessionUtils.ts` alongside its consumers.
