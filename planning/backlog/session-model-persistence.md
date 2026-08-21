# Session Model Persistence

## Summary

Persist the user's model choice per session to disk so it survives extension restarts and session switches.

## Current Behavior

When switching sessions or restarting the extension, the model selector resets to the configured default from `copilotCLI.model`. Any per-session model choice is lost.

## Desired Behavior

- When the user switches models within a session, persist that choice alongside the session data
- When resuming a session, restore the previously selected model
- The configured default (`copilotCLI.model`) is used only for new sessions

## Implementation Notes

- Session data lives at `~/.copilot/session-state/<session-id>/`
- Could add a `model.json` or extend `workspace.yaml` with the model field
- `handleSwitchSession` and `onSessionStarted` would read persisted model before falling back to config default
- `backendState.setCurrentModel()` call in the `model_switched` status handler would also write to disk

## Priority

~~Low — quality-of-life improvement.~~ **Scheduled 2026-08-21 into v3.13.0 P3 step 2**
(`planning/in-progress/v3.13.0-p3-host-owned-managers.md` §4.6). Not because it grew urgent, but
because P3 step 2 rewrites `handleSwitchSession` and the session-start path anyway — the two touch
points named above — so doing it separately means opening the same functions twice.

Two things settled there that this file left open:

- **Storage is `session-model.txt`, beside `session-name.txt`** — not `model.json`, not a
  `workspace.yaml` field. Plain text, one value, matching the precedent in that directory, and no
  read-modify-write to race.
- **The read must happen before the manager is constructed**, not just before the state is set.
  Otherwise the CLI starts on the config model while the UI shows the persisted one.

It is also row one of CLAUDE.md's *"intentional actions are treated intentionally"* table: switching
model mid-session is a gesture, `copilotCLI.model` is a standing default, and today the default wins
back on the next resume.
