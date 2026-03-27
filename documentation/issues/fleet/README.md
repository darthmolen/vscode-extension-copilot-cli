# Fleet Issues

Six issues discovered during fleet spike research (2026-03-17). All are candidates for the `github/copilot-sdk` issue board.

| File | Title | Severity |
|------|-------|----------|
| [FLEET-1](./FLEET-1-ignores-custom-agents.md) | `fleet.start()` ignores `customAgents` — always dispatches built-in agent types | High |
| [FLEET-2](./FLEET-2-task-complete-never-fires.md) | `session.task_complete` does not fire after fleet execution | Medium |
| [FLEET-3](./FLEET-3-session-idle-before-subagents-complete.md) | `session.idle` fires before all sub-agents complete | Medium |
| [FLEET-4](./FLEET-4-no-fleet-lifecycle-events.md) | No `fleet.*` lifecycle events — fleet state must be inferred from `subagent.*` | Low |
| [FLEET-5](./FLEET-5-no-per-agent-output-streaming.md) | Sub-agent output not streamed per-agent — aggregated only at end | Low |
| [FLEET-6](./FLEET-6-resume-session-custom-agents-timeout.md) | `resumeSession` with `customAgents` errors with malformed timeout message | Low |

## Spike Evidence

Raw data backing these findings:

- `planning/spikes/fleet-command/results/spike-06-output.json` — confirms FLEET-1, FLEET-2, FLEET-6
- `planning/spikes/fleet-command/results/07/spike-07-first-run.json` — confirms FLEET-3, FLEET-4, FLEET-5
