# Planning Review Workflow

Adversarial plan review loop between Claude Code and Copilot CLI. One agent authors a plan, the other reviews it, and the author processes feedback with technical rigor.

## Skills

| Skill | File | Purpose |
|-------|------|---------|
| `send-plan-review` | `~/.claude/skills/send-plan-review/SKILL.md` | Copy active plan to `planning/needs-review/` |
| `plan-review-intake` | `~/.claude/skills/plan-review-intake/SKILL.md` | Poll queue, dispatch reviewer subagent, append feedback |
| (subagent template) | `~/.claude/skills/plan-review-intake/plan-reviewer.md` | Plan quality review checklist and output format |
| `receive-plan-review` | `~/.claude/skills/receive-plan-review/SKILL.md` | Evaluate feedback with Accept/Merge/Reject/Flag |

## Workflow

```
[Agent A — Plan Author]
  Finishes plan → /send-plan-review
    → copies plan to planning/needs-review/<date>-<slug>.md

[Agent B — Reviewer (Claude Code)]
  /loop 5m /plan-review-intake
    → detects file in needs-review/
    → moves to needs-review/in-progress/    (before any processing)
    → dispatches plan-reviewer subagent
    → appends ## Plan Review section (Critical/Important/Minor)
    → moves to needs-review/reviewed/

[Agent A — Plan Author]
  /receive-plan-review (or /loop in Copilot)
    → detects file in needs-review/reviewed/
    → moves to needs-review/completed/      (before any processing)
    → evaluates each point: Accept / Merge / Reject / Flag
    → presents findings to user
    → applies accepted+merged revisions to original plan
```

## Folder Structure

```
planning/needs-review/              ← plans dropped here for review
planning/needs-review/in-progress/  ← currently being reviewed
planning/needs-review/reviewed/     ← review complete, feedback appended
planning/needs-review/completed/    ← fully processed (audit trail)
```

## File Naming

Format: `YYYY-MM-DD-<slug>.md` where slug is kebab-cased from the plan's H1 heading. Collisions get `-2`, `-3`, etc.

## Classification System (receive-plan-review)

When processing reviewer feedback, each point is classified:

| Classification | Meaning | Action |
|---------------|---------|--------|
| **Accept** | Reviewer is right, plan needs revision | Revise the original plan |
| **Merge** | Reviewer's idea enriches the plan | Incorporate partially or adapt; show original + suggestion + merged result |
| **Reject** | Reviewer is wrong or lacks context | State technical reasoning, no change |
| **Flag** | Cannot determine without user input | Present both sides, user decides |

## Managing the Loop

- **Start:** `/loop 5m /plan-review-intake`
- **List active loops:** `CronList`
- **Stop a loop:** `CronDelete` with the job ID from `CronList`

## Key Principles

- **Move before processing.** File moves happen before any review work begins. File system state reflects reality at all times.
- **Copy, not move** when sending. The original plan stays in its source location.
- **Audit trail.** The `completed/` copy is never modified. Revisions go to the original plan.
- **No performative agreement.** Feedback is evaluated with technical rigor, not accepted blindly.
- **Silent on empty.** Loop skills produce no output when there is nothing to process.
