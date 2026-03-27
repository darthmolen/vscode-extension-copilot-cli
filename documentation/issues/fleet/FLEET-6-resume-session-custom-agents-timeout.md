# FLEET: `resumeSession` with `customAgents` errors with malformed timeout message

**Repo:** `github/copilot-sdk` (Node.js SDK)
**Severity:** Low
**Affects:** `@github/copilot-sdk` Node.js ≥ 0.1.x

---

## Summary

Calling `client.resumeSession(sessionId, { customAgents: [...] })` to update custom agents on a live session produces a timeout error with a malformed message: `"Timeout after [object Object]ms"`. The `[object Object]` indicates the timeout value is an object being coerced to string without proper formatting, revealing a secondary SDK bug in the error-formatting code path.

---

## Steps to Reproduce

```javascript
import { CopilotClient } from '@github/copilot-sdk';

const client = new CopilotClient();
await client.connect();

// Step 1: Create a session
const session = await client.createSession({
    onPermissionRequest: async () => ({ approved: true }),
});
const sessionId = session.id;
await session.destroy();

// Step 2: Resume with customAgents (attempting to add agents post-creation)
try {
    const resumed = await client.resumeSession(sessionId, {
        onPermissionRequest: async () => ({ approved: true }),
        customAgents: [{
            name: 'post-creation-agent',
            displayName: 'Post Creation Agent',
            description: 'Added during resume',
            prompt: 'You are a post-creation agent.',
            tools: ['view'],
            infer: false,
        }],
    });
    console.log('Resume succeeded');
} catch (err) {
    console.error(err.message);
    // → "Timeout after [object Object]ms waiting for session.idle"
}
```

---

## Observed Behaviour

From spike-06:

```json
{
  "q3_resumeSessionAcceptsCustomAgents": {
    "question": "Does ResumeSessionConfig accept customAgents at runtime?",
    "resumeSucceeded": false,
    "resumeError": "Timeout after [object Object]ms waiting for session.idle",
    "agentsAfterResume": null,
    "answer": "NO/ERROR — Timeout after [object Object]ms waiting for session.idle"
  }
}
```

---

## Two Bugs in One

### Bug 1: `resumeSession` with `customAgents` fails

`ResumeSessionConfig` appears to accept `customAgents` (TypeScript types allow it), but the CLI backend rejects or ignores it and the session never reaches `idle`, triggering a timeout. It is unclear whether `customAgents` is intentionally unsupported on resume or whether this is a backend defect.

**Expected:** Either `resumeSession` with `customAgents` works (updating the registered agent list on the live session), or the TypeScript type `ResumeSessionConfig` excludes `customAgents` so callers are not misled.

### Bug 2: Malformed timeout error message

The error message `"Timeout after [object Object]ms"` is clearly a formatting bug. The timeout value — likely a config object or a `{ ms: number }` structure — is being converted to string via implicit `.toString()` instead of extracting the numeric value.

**Expected:** `"Timeout after 30000ms waiting for session.idle"` or equivalent.

---

## Workaround

Only set `customAgents` at initial `createSession`. Do not attempt to add or update agents via `resumeSession`:

```javascript
// ✅ Correct: set customAgents at creation time only
const session = await client.createSession({
    onPermissionRequest: async () => ({ approved: true }),
    customAgents: [{ name: 'my-agent', ... }],
});

// ❌ Incorrect: customAgents in resumeSession — errors with malformed timeout
const session = await client.resumeSession(id, {
    customAgents: [{ name: 'my-agent', ... }],
});
```

---

## Environment

- `@github/copilot-sdk` Node.js
- Spike date: 2026-03-17
