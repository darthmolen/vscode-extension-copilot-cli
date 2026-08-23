---
type: plan
---

# IN-6 — file snapshots across the process boundary

**Lane:** A · **Drafted:** 2026-08-22, from evidence gathered during the Zed run
**Status:** ready to start · **Revised size: Low**, not Medium — see §1
**Prerequisite:** none. IN-3 settled the shape this was waiting on.

---

## 1. What is left, and why it is smaller than the ticket says

The issue index describes IN-6 as *"FileSnapshot temp files across the process boundary"*, Medium
and blocking. That was written before IN-3 existed. **The display half is already done.**

`FileSnapshotService` writes the pre-edit content of a file into
`/tmp/copilot-cli-snapshots-XXXX/`, and `onDidProduceDiff` reports a **pair of paths** —
`beforeUri` (the temp copy) and `afterUri` (the file itself) — because VS Code's diff editor takes
URIs. A host on the far end of a pipe cannot read our temp directory.

IN-3 solved that by reading both files in `SdkSessionBackend` and sending **text** — ACP's `diff`
content type carries `path`, `oldText`, `newText`. Verified against a real host: Zed rendered the
diff. See `planning/in-progress/v5.0-in3-acp-agent.md` §4c.4.

**What remains is one bounded leak.**

### The leak

`cleanupDiffSnapshot(toolCallId)` exists on the manager and has **no caller on the ACP path**.

- In the extension, the webview calls it once a diff has been dismissed — there is a round trip, so
  something knows when the snapshot is finished with.
- Over ACP there is **no such round trip**. The agent sends the diff and the host renders it; nothing
  ever comes back to say it is done. So every edit leaves a temp file behind.

They are cleared only by `cleanupAllSnapshots()` via `manager.dispose()`, which runs on
`session/close`. And **Zed never called `session/close`** — measured, in the live run.

So in a long-lived agent process serving a host that does not close sessions, the snapshot directory
grows for the life of the process, one file per edit.

This is the same shape as the session-map leak `session/close` fixed, with the same twist: **the
cleanup exists and nothing in the wild triggers it.**

### What is NOT in scope, and is not "unsolved"

**Inline diff accept/reject.** In the extension, `AcceptanceControls` let a user accept or revert an
edit, and the snapshot is what a revert restores from. ACP has no equivalent concept — a host renders
a diff, it does not hand it back. This is a VS Code UI feature with no protocol counterpart, not a
gap to close. Recorded so the next reader does not go looking for it.

---

## 2. The decision to make first

**When is a snapshot finished with, in a world where nobody tells us?**

Three candidates, and the choice is the whole task:

| Option | Shape | Cost |
| --- | --- | --- |
| **A. Release after the diff is sent** | `SdkSessionBackend.readDiff()` already reads both files to build the ACP payload. Once the text is on the wire, the temp copy has no further reader. | Loses the ability to serve the same diff twice. Nothing asks to. |
| **B. Release at turn end** | Clear snapshots when `session.idle` fires. | Later than needed, and idle is per-turn so it is a natural boundary. Needs the emitter added in cross-talk 03 — already there. |
| **C. Cap the directory** | Keep the last N, evict oldest. | Bounds the leak without deciding the lifetime question. A cache, which is where staleness lives. |

**Recommendation: A**, with B as the safety net. The agent reads the file precisely once, at the
moment it converts a path pair into text; after that the temp copy is provably unreferenced. B
catches anything A misses — a diff event that never reaches `readDiff` because the current file could
not be read, for instance, which is a real path in the code today.

**Do not do C.** It converts a lifetime question into a tuning parameter.

---

## 3. Work

1. **A failing test first.** Drive `onDidProduceDiff` through a backend and assert the temp file is
   gone afterwards. It will not be.
2. **Release in `readDiff`** once the text has been extracted — including on the early-return path
   where the *current* file could not be read and no diff is forwarded. That path leaks today and is
   the easier one to forget.
3. **Safety net on idle.** Subscribe `onDidBecomeIdle` in `SdkSessionBackend` and sweep. Note it is a
   `SignalEmitter` and never replays, so a sweep only ever runs for an idle that actually happened.
4. **Do not touch the extension's path.** The webview round trip is correct for a surface that has
   one; this is about the case where nothing comes back.
5. **Mutation-test the release.** Break it and confirm the test goes red — the failure mode here is
   silent by construction, which is exactly the class that survives a green suite.

## 4. Verification

```bash
npm test
node planning/spikes/acp-agent/spike-through-the-wire.mjs      # 36/36
```

**Add an assertion to the wire spike**: after a prompt that edits a file, the snapshot directory holds
no more files than before. That is the only check that would have caught this, and its absence is why
IN-3 shipped with the leak.

Count the directory rather than a single path — a per-file assertion passes while the directory fills.

## 5. What this does not fix

A host that never closes a session still leaks **everything else** the manager holds — the SDK
session, the CLI-side conversation, the subscriptions. `session/close` releases all of it and Zed
never called it. That is a larger question than snapshots and belongs with whatever decides whether
an agent should reap idle sessions on its own. **Not this ticket**; recorded because fixing the
snapshot leak alone could read as fixing the leak.
