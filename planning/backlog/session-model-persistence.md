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

Low — quality-of-life improvement. The current behavior (reset to default) is functional.
