# Detached sessions — can the CLI's own flag carry work↔plan pairing?

**Run:** 2026-08-22, real CLI 1.0.68, live auth · **Scripts:** `spike-detached.mjs`,
`spike-detached-emitstart.mjs` · **Asked by:** Lane B for P4.

## Verdict

**No — and for a better reason than "it is not reachable".** Even where the flag *is* honoured, it
cannot express a pairing: the CLI consumes `detachedFromSpawningParentSessionId` to mark the child
detached and then **discards the parent id**. Nothing in the child records what it was detached
*from*.

So this was never a candidate to replace `session-pairing.json`. It is a hide-me boolean, and P4
needs child→parent.

## What was measured

| Question | Result |
| --- | --- |
| Does `client.createSession()` forward unknown config fields? | **No.** It builds the `session.create` payload field by field with no `...config` spread (`client.ts:1397`), so an unknown field is dropped silently. |
| Is `sessions.open` the same path? | **No.** Different RPC. `createSession` calls `session.create`. |
| Does `sessions.open` accept the flag? | **Yes** — returns `{status:'created', sessionId}`. |
| Is the flag honoured? | **Yes, as a marker.** The CLI writes an empty `.detached` file into the session directory. Exactly one session in a 912-session store had one: ours. |
| Is the parent id persisted? | **No.** `grep -rl <parentId>` across the whole child directory finds nothing. Contents are `.detached`, `workspace.yaml`, `checkpoints/index.md` — and `workspace.yaml` has no parent field. |
| Is it listed with `includeDetached: true`? | **No** — 912 rows, absent. |
| Is it hidden with `includeDetached` omitted? | Absent, but **vacuously**: 912 rows both ways. The flag changed nothing, because the session never enters the index at all. |
| Does it resume through the normal path? | **No.** `session.resume` → *"Session not found"*, with `emitStart: true` as well. |
| Does it get an `events.jsonl`? | **No**, even with `emitStart: true`. |

## What `sessions.open` actually produces

A **stub**: a directory with a `.detached` marker and a `workspace.yaml`, invisible to
`sessions.list` in either mode and unresumable. Not a session in any sense a client can use.

That is the answer to the cost question on its own. The hoped-for two-step — open with the flag,
then resume through `createSession`/`resumeSession` to get a wired session — **does not work**. There
is no path to the flag that keeps `createSessionWithModelFallback`, `onPermissionRequest`,
`clientName`, `streaming` and `skillDirectories`, because there is no path to the flag that yields a
usable session at all.

## The trap in these numbers

"Hidden by default" **passed** in the first run and means nothing. The session was absent from
*both* listings, so the check could not distinguish "the flag hid it" from "it was never there".
A passing assertion that cannot fail for the reason you care about is not evidence — it is the same
shape as a green test with no caller.

## What this does not rule out

`includeDetached` may well work for sessions the CLI itself detaches through paths we did not
exercise (the field sits beside `detachedFromSpawningParentEngagementId` and the remote/cloud
options, which suggests it exists for sub-agent or remote spawning). This says only that **we**
cannot get there from the SDK's create path, and that the parent id does not survive even when we do.

**Litter:** two stub sessions were created and then removed — they were unusable and unlistable.
