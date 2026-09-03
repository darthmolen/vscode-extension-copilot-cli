# Spike: `createSession()` with an existing `sessionId`

**Date:** 2026-09-01
**Script:** `spike-session-id-reuse.mjs`
**Environment:** CLI + SDK 1.0.80 from `globalStorage/darthmolen.copilot-cli-extension/cli/_1.0.67/node_modules/@github/copilot-win32-x64`, Node 24.0.0, model `claude-sonnet-4.6`

## Question

`enablePlanMode()` creates the plan session with a derived, predictable id:

```ts
const planSessionId = `${this.workSessionId}-plan`;   // sdkSessionManager.ts:1732
this.planSession = await this.createSessionWithModelFallback({
    sessionId: planSessionId, ...                     // sdkSessionManager.ts:1787
});
```

On every entry into plan mode after the first, that id already exists on disk. The SDK documents `sessionId` only as *"Optional custom session ID. If not provided, the server generates one"* (`types.d.ts:2113-2116`) and says nothing about collision.

Does re-creating an existing id **continue** that conversation or **start it over**?

## Method

Two rounds against one id, each with a fresh `CopilotClient`:

1. `createSession({ sessionId })` → "Reply with exactly this one word: ALPHA" → `client.stop()`
2. `createSession({ sessionId })` **same id** → "What single word did I ask you to reply with earlier? If you have no earlier message from me, reply exactly NO_HISTORY. Then say BRAVO." → `client.stop()`

Two signals recorded separately, because they can disagree: what lands on disk, and what the model actually remembers.

## Result

```
                       round1 -> round2
  events.jsonl lines : 8  -> 16
  session.start count: 1  -> 2
  ALPHA on disk      : true -> true

  disk appended      : true
  disk kept ALPHA    : true
  model recalled     : false
```

Round 2's reply, verbatim:

> `NO_HISTORY. BRAVO.`

**Verdict: APPENDS-ONLY.** Re-creating an existing id writes a *second* `session.start` into the same `events.jsonl` and keeps the old lines, but the model starts with an empty context. The prior transcript survives on disk as dead content.

## Consequences

### 1. The plan-mode restore question is settled — Option A

**Superseded by spikes 2 and 3 — kept for the reasoning trail.** The conclusion below (show work history, hide plan history) was correct given only spike 1, but spikes 2 and 3 opened a better option: resume the plan session so its conversation is genuinely live, and keep showing it. See the plan's change 5.

After closing VS Code in plan mode, the chat must **not** display the plan session's history *if the plan session is still re-created*. Doing so would show the user a conversation the agent has no memory of — worse than showing nothing, because it looks live.

Strip the `-plan` suffix when calling `loadSessionHistory` only. Keep passing the unstripped id to `startCLISession`, so `SDKSessionManager` still sees the suffix ([sdkSessionManager.ts:528](../../src/sdkSessionManager.ts)), resumes the work session, and restores plan mode ([:629-632](../../src/sdkSessionManager.ts)). The chat then shows the work session that is genuinely resumed.

### 2. Separate pre-existing bug: history stitches across re-creations

`SessionService.loadSessionHistory` ([SessionService.ts:256-300](../../src/extension/services/SessionService.ts)) collects **every** `user.message` and `assistant.message` line in the file. It has no notion of `session.start` boundaries.

So for any id that has been re-created — which plan sessions do by construction, once per plan-mode entry — the panel concatenates all past conversations into a single thread, and only the final segment is one the agent remembers. A user who enters plan mode three times has three stitched conversations displayed as one.

Fix: when reading history, keep only the messages after the **last** `session.start`. This is independent of the resume bug and applies to any reused id.

## Follow-up spike 2: does `resumeSession` restore context? (`spike-resume-vs-create.mjs`)

The first spike only exercised `createSession`. The work session uses a different API — `client.resumeSession` ([sdkSessionManager.ts:416](../../src/sdkSessionManager.ts)) — so "the work session's history is live" was an assumption, not a result. Same ALPHA probe, via resume:

| API on an existing id | model recalls earlier turn | `session.start` count |
|---|---|---|
| `createSession({ sessionId })` | no — replies `NO_HISTORY` | 1 -> **2** |
| `resumeSession(sessionId)` | **yes** — replies `ALPHA` | 1 -> 1 |

**The two APIs genuinely differ.** `resumeSession` restores conversational memory; re-creating an existing id does not. The work session really is live after restore. This is what makes the better fix possible: resume the plan session too, rather than settling for showing work-session history.

## Follow-up spike 3: is `availableTools` enforced on resume? (`spike-resume-tool-enforcement.mjs`)

Resuming the plan session is only safe if the runtime still enforces the plan-mode tool whitelist ([planModeToolsService.ts:25-41](../../src/extension/services/planModeToolsService.ts)). `ResumeSessionConfig` *declares* `availableTools`; declaring is not enforcing.

Tested behaviourally rather than by tool listing — restrict to `['view','grep','glob']`, ask the agent to create a file, and check the filesystem:

| Phase | Config | File created |
|---|---|---|
| A — `createSession` | restricted | no |
| B — `resumeSession` | restricted | no |
| C — **control** | unrestricted | **yes** |

The control matters. Without it, "no file" is ambiguous: the prompt tells the model to reply `BLOCKED` when it has no write tool, so an untried write looks identical to a blocked one. The control writing the file proves the probe detects writes when they are permitted.

**Verdict: enforced on resume.** Change 5 keeps plan mode's no-write guarantee.

Note: `session.rpc.tools.list` is not a function on this SDK build, so the advertised-tool listing is unavailable. The behavioural probe is the check.

## Reproducing

```bash
node planning/spikes/plan-session-reuse/spike-session-id-reuse.mjs        # cleans up after itself
node planning/spikes/plan-session-reuse/spike-session-id-reuse.mjs --keep # keep the session dir
```

Writes only to `~/.copilot/session-state/spike-plan-reuse-<ts>/`; touches no real session. Costs two model calls.

## Note on wiring

`cliPath` must be the native `copilot.exe` inside the platform package. Passing the `.bin/copilot.cmd` shim or `@github/copilot/npm-loader.js` both fail with:

> Could not resolve a @github/copilot platform package (tried @github/copilot-win32-x64).

The extension itself passes `npm-loader.js` ([cliBundleService.ts:101,173](../../src/extension/services/cliBundleService.ts)), which works there because the SDK resolves the sibling platform package from within that install tree. A standalone script importing the SDK by absolute path does not get that resolution, so point both the SDK import and `cliPath` at the same platform package.
