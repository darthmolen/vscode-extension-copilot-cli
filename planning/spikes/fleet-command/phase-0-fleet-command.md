# Phase 0: Fleet Command Spike

**Date**: 2026-03-12
**Goal**: Discover how the SDK exposes fleet/subagent functionality before implementing anything in the extension.
**Prerequisite**: GitHub token with Copilot access, `@github/copilot-sdk` installed locally.

## Questions to Answer

| # | Question | Spike |
|---|----------|-------|
| 1 | What events does the SDK emit when `/fleet` is used? What are the exact payloads? | `spike-01-fleet-events.mjs` |
| 2 | Can we trigger `/fleet` programmatically, or must it go through `sendAndWait`? | `spike-02-fleet-trigger.mjs` |
| 3 | How do subagent events interleave with tool events? | `spike-01-fleet-events.mjs` |
| 4 | Can we access individual subagent status/output via SDK RPC? | `spike-03-subagent-access.mjs` |
| 5 | What happens on abort while subagents are running? | `spike-03-subagent-access.mjs` |
| 6 | Does `/tasks` have an SDK equivalent, or is it CLI-only? | `spike-02-fleet-trigger.mjs` |

## How to Run

```bash
# From project root, with GitHub token available
node planning/spikes/fleet-command/spike-01-fleet-events.mjs
node planning/spikes/fleet-command/spike-02-fleet-trigger.mjs
node planning/spikes/fleet-command/spike-03-subagent-access.mjs
```

Each spike logs all events to stdout AND writes a structured JSON log to `planning/spikes/fleet-command/results/spike-0X-output.json`. Run each spike, review the output, then fill in the FINDINGS section at the bottom of this file.

## Spike Scripts

See the three `.mjs` files in this directory. Each one is standalone and answers specific questions.

---

## FINDINGS (Fill in after running spikes)

### Spike 01: Fleet Event Discovery

**Raw event types observed**: _(fill in)_

**subagent.started payload**:
```json
// paste actual payload here
```

**subagent.completed payload**:
```json
// paste actual payload here
```

**subagent.failed payload** (if triggered):
```json
// paste actual payload here
```

**subagent.selected payload** (if triggered):
```json
// paste actual payload here
```

**Event ordering**: _(Do subagent events interleave with tool events? Do they arrive in order? Is there a "fleet.started" or "fleet.completed" wrapper event?)_

**Other unexpected events**: _(any events we didn't anticipate)_

---

### Spike 02: Fleet Trigger Mechanism

**Can `/fleet` be sent via `sendAndWait({ prompt: '/fleet ...' })`?** _(yes/no + details)_

**Is there a dedicated SDK RPC method for fleet?** _(yes/no + method name if yes)_

**Does `/tasks` have an SDK RPC equivalent?** _(yes/no + method name if yes)_

**How does the SDK indicate fleet mode is active?** _(event? state? rpc method?)_

---

### Spike 03: Subagent Access & Lifecycle

**Can we query individual subagent status?** _(yes/no + how)_

**Can we read subagent output separately?** _(yes/no + how)_

**What happens on abort?** _(do subagents stop? do we get failed events? is there a fleet-level abort?)_

**Can we kill individual subagents?** _(yes/no + how)_

---

## Postmortem

_(Write this after all spikes are run. What did we learn? What surprised us? How does this change the implementation plan in `planning/backlog/fleet-command.md`?)_

### What worked as expected

-

### What surprised us

-

### Plan modifications needed

-

### Risks identified

-
