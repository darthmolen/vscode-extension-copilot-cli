# S-B — two clients, one session id

**Run:** 2026-08-22 · bundled CLI `@github/copilot` 1.0.68 · SDK 0.3.x · Node 24.13.1
**Script:** `spike-already-in-use.mjs` · **Raw:** `results/result.json`
**Verdict: the runtime tolerates it. A warning is the right strength; a hard refusal is not.**

## Why it was run

P3 §4.5 makes the session dropdown reveal-or-reattach instead of starting a second manager
for a session already running. The plan asked how hard the guard behind that has to be —
and warned explicitly: *"Do not infer this from the field's existence. That it is reported
rather than rejected suggests tolerance; it does not establish it."*

## What it found

**1. `sessions.checkInUse` is real, exposed by our bundled CLI, and precise.**

```
{ "inUse": ["74b94087-9c1b-4e88-ab3a-0457249ef512"] }
```

It named the held session and did not name an id nobody holds. So *"is this session held
by another process"* is a **call**, not an inference — and it is authoritative across
windows, which our own registry can never be.

**2. Resuming it anyway is not refused.** A second client, in a second CLI process,
resumed a session the first was holding. No error. Both then completed a turn on it
concurrently, also with no error.

**3. `events.jsonl` did not corrupt.** 5 lines before the intruder, 16 after, **0
unparseable**. The log is a coherent interleaving of two conversations.

**4. `alreadyInUse` was not observable from the client event stream.** The listener the
spike attached (`client.on('session.start')`) reported `null`. That is a finding about
*reachability*, not about the field: it appears in the session events we log, so the
extension can see it — but it is not trivially available where a pre-flight check would
want it. `sessions.checkInUse` is the better door and needs no event plumbing at all.

## What it decides

| Question | Answer |
| --- | --- |
| Hard refusal or warning? | **Warning.** The runtime copes; refusing would be us inventing a restriction the CLI does not impose |
| Is the transcript at risk? | Not structurally. It stays parseable — it just contains two conversations, which is confusing rather than broken |
| Which API? | **`sessions.checkInUse`**, not `alreadyInUse`. One call, a set in and a subset out, no event subscription |

## Status in v3.13.0

**The in-window case is already closed** and does not depend on this: `planSessionSwitch`
consults the registry before anything starts, and `ChatPanelService.openSession` already
did. Those cover every collision this extension can cause on its own.

**The cross-window case is not wired**, and is a P3 leftover rather than a gap in the
above. The call needs the SDK client, which lives behind `SDKSessionManager` — Lane A's
file. Raised as cross-talk thread `B-to-A-03`. Given this spike's result, the cost of not
having it is a confusing transcript in a rare situation, not data loss.
