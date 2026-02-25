# Model Switching Spike — Findings

**Date**: 2025-02-25
**Spike**: `planning/spikes/model-switching/spike-model-switch.mjs`

## Summary

The SDK and CLI work correctly. The bug is entirely in our extension code.

## Experiments

| # | Question | Result |
|---|----------|--------|
| 1 | `session.rpc.model.getCurrent()` works? | YES — returns correct model |
| 2 | `session.rpc.model.switchTo()` works? | YES — instant, fires `session.model_change` event |
| 3 | `resumeSession({ model })` overrides? | YES — correctly resets to requested model |
| 4 | Cross-session model leak? | NO — sessions are isolated |
| 4b | Resume leak? | NO — resumed sessions respect requested model |

## Root Cause

Our `attemptSessionResumeWithUserRecovery()` at `sdkSessionManager.ts:482-488` does NOT pass `model` in resume options:

```typescript
this.session = await this.attemptSessionResumeWithUserRecovery(
    this.sessionId,
    {
        tools: this.getCustomTools(),
        hooks: this.getSessionHooks(),
        ...(hasMcpServers ? { mcpServers } : {}),
        // ❌ MISSING: model: this.config.model
    }
);
```

Without the `model` parameter, `resumeSession()` keeps whatever model the session had last.

## Additional Findings

### SDK provides proper model-switching APIs we don't use

The SDK session object has `session.rpc.model.switchTo({ modelId })` and `session.rpc.model.getCurrent()`. These are the correct way to switch models — no need to destroy and recreate sessions.

Our current `switchModel()` implementation (`sdkSessionManager.ts:1267`) destroys the session and recreates it via `resumeSession()`. This is unnecessary and heavy-handed.

### `session.model_change` event

The SDK fires `session.model_change` with `{ previousModel, newModel }` when `switchTo()` is called. Our extension logs it (`sdkSessionManager.ts:754`) but doesn't act on it.

## Recommended Fix

1. **Immediate**: Add `model: this.config.model` to the resume options at line 485
2. **Better**: Replace `switchModel()` destroy/resume with `session.rpc.model.switchTo()`
3. **Also**: Handle `session.model_change` event to keep UI in sync
4. **Also**: Use `session.rpc.model.getCurrent()` after resume to verify actual model
