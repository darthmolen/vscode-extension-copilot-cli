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

**Use the SDK's dual-session capability to run planning in an isolated session with a restricted tool whitelist.**

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

## Notes

- First implemented in commit `6b29748` (Jan 30 2026) — replaced the `[[PLAN]]` prefix hack
- The `PlanModeToolsService` (`src/extension/services/planModeToolsService.ts`, 606 lines) defines all custom plan-mode tools
- Session naming convention: work session `<id>`, plan session `<id>-plan` — predictable and debuggable
- The dual-session pattern is also why ADR-005 (slash commands as fallback) was critical — if plan mode UI buttons broke, users needed `/accept` and `/reject` to escape
