# ADR-003: Separate Planning Session with Restricted Tools

**Status**: Accepted
**Date**: 2026-01-30 (v2.0.6)
**Driver**: Tokens and context are precious with present-day LLMs. Planning and execution compete for the same context window, and an unrestricted planning agent can accidentally modify files.

## Context

Tokens and context are precious with present-day LLMs. It's given rise to methodologies such as ACE-FCA (Advanced Context Engineering with Frequent Compaction) and heavy sub-agent architectures that isolate different phases of work into separate contexts. We'd been watching these patterns and saw the problem firsthand: when the AI plans and executes in the same session, the planning context crowds out the execution context, and the execution context crowds out the plan.

The Copilot CLI SDK's `Session` abstraction gave us an opportunity. Each session is an independent context with its own conversation history, tool access, and system prompt. We could create a **plan session** that is isolated from the **work session** — separate context windows, separate tool sets, separate concerns.

The key design constraint: the planning agent must be **read-only**. It should explore the codebase, think about architecture, and write a plan document. It should NOT be able to edit source files, run arbitrary commands, or make changes. If the planning agent can modify files, there's no clean boundary between "thinking about what to do" and "doing it."

Early attempts used a `[[PLAN]]` prefix hack in messages to signal plan mode within a single session. This was fragile — the AI would sometimes ignore the prefix and execute changes anyway. Real isolation required real session separation.

## Decision

**Use the SDK's session capability and follow a dual-session pattern to run planning in an isolated session with a restricted tool whitelist.**

### Architecture

```text
Work Session (full tools)              Plan Session (restricted tools)
┌─────────────────────────┐           ┌─────────────────────────┐
│ All SDK tools available  │           │ Read-only exploration:  │
│ edit, create, bash, etc. │  switch   │ view, grep, glob        │
│                          │ ◄──────► │                          │
│ Session ID: <id>         │           │ Plan-only writes:       │
│ Full system prompt       │           │ edit_plan_file,          │
│                          │           │ update_work_plan,        │
│                          │           │ present_plan             │
│                          │           │                          │
│                          │           │ Session ID: <id>-plan    │
│                          │           │ Plan-mode system prompt  │
└─────────────────────────┘           └─────────────────────────┘
         ▲                                      │
         │            On accept:                │
         │            1. Plan → plan.md          │
         │            2. Switch to work session  │
         │            3. Inject implementation    │
         │               prompt with plan path   │
         └──────────────────────────────────────┘
```

### Tool Whitelist (Plan Session)

Only these tools are available during planning:

- **Exploration**: `view`, `grep`, `glob`, `web_fetch`, `fetch_copilot_cli_documentation`
- **Plan-specific**: `edit_plan_file`, `create_plan_file`, `update_work_plan`, `present_plan`
- **Scoped execution**: `plan_bash_explore` (read-only bash — only `ls`, `pwd`, `git status`, etc.)
- **Agent dispatch**: `task_agent_type_explore` (exploration sub-agents only)
- **Reporting**: `report_intent`

Standard `edit`, `create`, and `bash` (full) are explicitly denied.

### Session Handoff

**Accept plan:**

1. Plan content is preserved in `plan.md`
2. Plan session snapshot is cleared
3. Mode switches back to work session
4. An implementation prompt is auto-injected: "Start implementing the plan at `plan.md`"
5. `plan_accepted` status event fires to the UI

**Reject plan:**

1. `plan.md` is restored from the pre-plan-mode snapshot
2. Mode switches back to work session
3. `plan_rejected` status event fires
4. Work session resumes with no trace of the rejected plan

### Cost Control

Only one session is active at a time. The plan session does not consume tokens while the work session is active, and vice versa. This is not 2x the cost — it's the same cost with better context isolation.

## Consequences

**Positive:**

- Planning gets a clean context without execution history cluttering it
- The plan agent cannot accidentally modify source files — tool restrictions are enforced at the SDK level, not by prompt instructions
- Plan acceptance/rejection is atomic — accept keeps changes, reject restores the snapshot
- Context efficiency — the work session doesn't waste tokens on planning conversation
- Aligns with ACE-FCA principles without requiring the full methodology

**Negative:**

- Two sessions to manage — session switching adds complexity to `SDKSessionManager`
- Plan session creation has latency (SDK creates a new session with the LLM)
- The plan agent is limited — it can't do things like run tests to validate its plan
- Snapshot management for `plan.md` adds state tracking

> Two of these were understated. See the v4.1.0 amendment below: "two sessions to manage" hid a
> lifecycle bug that lost the planning conversation on every re-entry, and creation latency was the
> visible half of a correctness problem — creating rather than resuming also discarded the context.

## Notes

- First implemented in commit `6b29748` (Jan 30 2026) — replaced the `[[PLAN]]` prefix hack
- The `PlanModeToolsService` (`src/extension/services/planModeToolsService.ts`, 606 lines) defines all custom plan-mode tools
- Session naming convention: work session `<id>`, plan session `<id>-plan` — predictable and debuggable
- The dual-session pattern is also why ADR-005 (slash commands as fallback) was critical — if plan mode UI buttons broke, users needed `/accept` and `/reject` to escape


---

## Amendment — v4.1.0 (2026-09-02): the lifecycle, corrected

The decision above stands. How the two sessions are *brought back* did not, and three things in the
original write-up are now wrong. Kept as an amendment rather than an edit, because the reasoning
matters more than the conclusion.

### 1. The plan session is resumed, not re-created

`enablePlanMode()` created the plan session with a derived id, `<work-id>-plan`. On the second and
later entries that id already existed. The SDK documents `sessionId` only as *"Optional custom
session ID"* and says nothing about collision, so this was assumed to continue the session.

It does not. Measured (`planning/spikes/plan-session-reuse/`):

| API against an existing id | model recalls the earlier turn | `session.start` count |
| --- | --- | --- |
| `createSession({ sessionId })` | no — replies `NO_HISTORY` | 1 → **2** |
| `resumeSession(sessionId)` | **yes** | 1 → 1 |

Re-creating appends a second `session.start` and keeps the old lines on disk while handing the model
an empty context. So every entry into plan mode restarted the planning conversation, and the panel
replayed a transcript the agent could not remember. Plan mode now resumes when the plan session has a
transcript, and creates only on first entry.

**The tool whitelist survives resume.** That had to be proven, not assumed — `ResumeSessionConfig`
*declares* `availableTools`, and declaring is not enforcing. A restricted session was asked to write a
file, with an unrestricted control to show the probe could detect a write at all: create blocked,
resume blocked, control wrote. The read-only guarantee this ADR exists to provide holds on both paths.

### 2. Startup does not resurrect the work session

Restoring plan mode used to strip `-plan` and resume the *work* session first, then re-enter plan
mode. That was vestigial — it existed only because plan sessions were not resumable, so the work
session was the sole anchor that survived a restart.

It also failed outright. A work session abandoned for plan mode before any message has a directory
(`workspace.yaml`, `plan.md`) but **no transcript**, and `session.resume` answers `Session not found`
— surfacing as the "Previous session not found" dialog. Startup now resumes the plan session
directly and leaves the work session unmade; `disablePlanMode()` mints it, which is the one moment it
is needed and where the code already created one on demand.

It is created under the *derived* id rather than a fresh UUID, so the pairing holds and the next entry
into plan mode finds the same plan session instead of orphaning it. Safe because that id has no
transcript to overwrite — which is the whole reason there was nothing to resume.

### 3. The naming convention is now a contract

The original note read: *"Session naming convention: work session `<id>`, plan session `<id>-plan` —
predictable and debuggable."* Predictable, and also invisible: `id.endsWith('-plan')` acquired a
second reader in v3.13.0 that had never heard of the convention, and a third here. It is now owned by
`src/extension/session/sessionPairing.ts`, backed by `session-pairing.json` on the plan session, with
the suffix as a read-only fallback for the plan halves already on disk.

**Do not add a fourth reader.** Ask `resolvePairings` (batch, for listing) or `resolveStartupPairing`
(single, for the resume path).

### Consequence worth stating plainly

"Only one session is active at a time" was true and remains true, but it made the pair sound
stateless. They are not: each half is a durable, separately-resumable conversation, and which half is
*recorded* as the user's choice determines what comes back after a restart. Entering plan mode is a
gesture in CLAUDE.md's sense, and it now gets recorded like one.
