# Spike: `sessions.fork` against the bundled CLI

**Date:** 2026-08-15 · **Script:** `spike-fork.mjs` · **Results:** `results/fork-spike.json`
**Environment:** Node 24.13.1, bundled CLI **1.0.68** (`@github/copilot-linux-x64/copilot`), SDK 1.0.5, live auth

## Verdict: 8/8 — the RPC works, but it does not fix the bug on its own

| # | Claim | Result |
| --- | --- | --- |
| 0 | Talking to the **bundled** CLI, not one on PATH | ✅ `node_modules/@github/copilot-linux-x64/copilot` |
| 0b | CLI identity matches the bundled package | ✅ package 1.0.68 · binary reports `GitHub Copilot CLI 1.0.68` |
| 1a | Parent session created and answered | ✅ |
| 1b | `sessions.fork` exposed by this CLI | ✅ `typeof fork === 'function'` |
| 1 | `sessions.fork` succeeds | ✅ returns `{ sessionId, name }` |
| 2 | The `name` we pass lands | ✅ **but see below** |
| 2b | Parent's own name untouched | ✅ |
| 3 | Fork resumable while parent still live on the same client | ✅ |

## The finding that changes the implementation

`name` **is** honoured — the RPC echoes it back and the CLI persists it to the fork's
`workspace.yaml`:

```yaml
id: 385d7269-f132-40c3-83e5-3e2d320337ff
client_name: fork-spike
name: Spike Parent (fork 1786832697162)
```

But the CLI does **not** write `session-name.txt`, and that is the first thing
`SessionService.formatSessionLabel` looks at. Its priority chain is:

1. `session-name.txt` — **absent on a fork**
2. `plan.md` first H1 — absent
3. `workspace.yaml` **`summary`** — the CLI writes `name`, not `summary`
4. 8-char session-id prefix ← **what actually renders**

Measured directly against the spike's own artifacts:

```
fork   -> "385d7269"
parent -> "575a8816"
```

So a fork created purely through the RPC would still show a meaningless id in the session
dropdown. **Passing `name` to `sessions.fork` is necessary but not sufficient.**

### Consequence for Slice 1

The naming contract must write `session-name.txt` on **both** paths, not just the fallback:

- **Native:** call the RPC with `name`, *then* `writeSessionName(forkDir, name)`.
- **Fallback:** `writeSessionName(destDir, name)` as already planned.

Same computed string, same file, both paths. This keeps `formatSessionLabel` untouched and makes
the two paths produce an identical user-visible result.

### Follow-up worth filing separately

`formatSessionLabel` ignores `workspace.yaml`'s `name:` field entirely — it only reads `summary`.
Any session the CLI names (not just forks) is therefore mislabeled in our dropdown. Teaching the
resolver to read `name` before `summary` is the more complete fix, but it changes labels for
existing sessions, so it does not belong in this slice.

## What this does not prove

- **`toEventId`** was not exercised. `rpc.d.ts:11384` documents it as exclusive; Slice 3 verifies
  it empirically when it needs to.
- **Older CLIs.** Only 1.0.68 was tested, so the method-not-found fallback path is unexercised
  against a real old CLI — its tests will have to simulate the `-32601` rejection.
- **Concurrency.** The parent was idle during the fork; forking mid-turn is untested.

## Cleanup

The spike leaves two real sessions behind in `~/.copilot/session-state/`:
`575a8816-…` (parent) and `385d7269-…` (fork). Safe to delete.
