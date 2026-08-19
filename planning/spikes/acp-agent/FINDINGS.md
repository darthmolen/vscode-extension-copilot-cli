# Spike: SDKSessionManager outside the extension host

**Date:** 2026-08-15
**Script:** `spike-out-of-host.mjs` (`--offline` skips the live SDK steps)
**Results:** `results/out-of-host-live.json`, `results/out-of-host-offline.json`
**Environment:** Node 24.13.1, `@github/copilot` 1.0.68, CLI `@github/copilot-linux-x64/copilot`, live auth

## Question

The v4.0 re-plan turns `SDKSessionManager` into an ACP-speaking agent in its own
process. Plan mode's entire security model is six host-side `defineTool()`
closures plus a 13-name `availableTools` whitelist. **If those closures stop
firing once the manager leaves the extension host, the direction loses plan mode**
— which would be disqualifying.

The spike runs as a plain Node process with `require('vscode')` **banned**
(throws `MODULE_NOT_FOUND`), the same condition an agent subprocess faces.

## Verdict: 8/8 — plan mode survives out-of-host

| # | Claim | Result |
| --- | --- | --- |
| 1 | Manager module loads with vscode absent | ✅ |
| 1b | Constructs with an injected `HostBridge` | ✅ |
| 0 | Resolves a CLI entry point | ✅ `@github/copilot-linux-x64/copilot` |
| 4a | Six plan-mode tool closures build outside the host | ✅ `create_plan_file, edit_plan_file, plan_bash_explore, present_plan, task_agent_type_explore, update_work_plan` |
| 4b | `availableTools` whitelist intact | ✅ 13 entries |
| 2 | Real SDK session starts from a non-host process | ✅ `f280a7a0-…` |
| 3 | Plan mode enables (dual session) | ✅ `mode=plan` |
| **5** | **A plan-mode tool closure EXECUTES in-process** | ✅ **wrote `plan.md` containing the run's unique marker** |

Step 5 is the one that matters. The model was asked to call `update_work_plan`;
the handler — a JavaScript closure living in the spike's process — ran and wrote:

```markdown
# SPIKE-MARKER-1786809467427
- proof of life
```

to `~/.copilot/session-state/f280a7a0-…/plan.md`. The marker is minted per run,
so this cannot be a stale file. **Tool callbacks reach back into our process
rather than resolving inside the CLI.**

Status sequence observed end to end:
`reset_metrics → ready → plan_mode_enabled → model_switched → session_renamed → thinking → ready → thinking → ready → stopped`

## Why this does not contradict cli#1574

cli#1574 ("custom tools silently ignored in ACP") and cli#1607 ("ACP lacks
session-level tool permission primitives) are about **`copilot --acp`**, where
the CLI itself acts as the ACP agent. That was the design of the abandoned
`feature/4.0-acp-migration` branch: *replace the SDK with an ACP client*.

The reframed direction is the opposite orientation:

```text
host ──ACP──▶ our agent ──Copilot SDK──▶ CLI
```

We keep the SDK, and expose ACP **outward**. `copilot --acp` is never invoked,
so neither blocker is on our path. This spike is the evidence: custom tools
worked, over the SDK, from a process with no extension host.

## What this does not prove

Deliberately out of scope — do not read more into it than it shows:

- **No ACP wire was spoken.** The spike proves the *agent-side half* (SDK drive
  + tool closures out-of-host). Wrapping that in an ACP server is untested.
- **No AHP client was exercised.** The dock-over-AHP mapping remains on paper.
- **`FileSnapshotService` temp-file lifetime across a real process boundary**
  was not tested; the spike is single-process.
- **The host bridge was a stub.** A real agent process needs a settings snapshot
  and a way to answer `askSessionRecovery` without a UI.
- Single platform (Linux), single run.

## Consequences for the plan

1. The **highest-risk unknown is cleared**. Feasibility for the agent half is
   HIGH.
2. `messageEnhancementService` correctly stayed behind: the spike ran with no
   `createMessageEnhancer` at all and prompts went through unenhanced, which is
   exactly the intended client-side split.
3. The remaining risk concentrates on the **client half** (webview → AHP) and on
   **whether any host will front a third-party agent** — neither of which this
   spike touches.

---

## Cycle 0 (IN-3 permissions): `onPreToolUse` suppresses `onPermissionRequest`

**Spike:** `spike-permission-hook.mjs` · **Raw:** `results/permission-hook.json` · run 2026-08-19
against the real CLI (`@github/copilot-linux-x64`), SDK direct, no extension, no `--yolo`.

Same prompt (`echo <marker>`, which the CLI gates as a `shell` permission) through five session
configs differing only in the `onPreToolUse` hook:

| Case | hook returns | handler fired | request `kind` |
| --- | --- | --- | --- |
| B (control) | *no hooks at all* | **yes** | `shell` |
| A | `{ permissionDecision: 'allow' }` | **no** | — (no event at all) |
| C | `{ permissionDecision: 'ask' }` | yes | **`hook`** |
| D | `{}` | **yes** | `shell` |
| E | `undefined` | **yes** | `shell` |

**Three things this settles.**

1. **The feature was genuinely dead on arrival.** `getSessionHooks()` returns
   `{ permissionDecision: 'allow' }` at all twelve session-creation sites, and case A shows the CLI
   then emits *no* `permission.requested` event whatsoever — not even one flagged `resolvedByHook`.
   The SDK's `resolvedByHook` early-return at `session.ts:505` never even gets the chance to fire.
   Had we written the mapper first, every test would have passed and nothing would have worked.

2. **`'ask'` — the fix the plan proposed — is the wrong one.** It does restore a request, but the
   request arrives as the generic `hook` variant, which carries only `toolName` and a JSON blob of
   `toolArgs`. All of `fullCommandText`, `commands[]`, `intention`, `possiblePaths` and
   `canOfferSessionApproval` are gone. A host handed that can only render "the agent wants to run
   bash" — which defeats the point of forwarding. Compare, for the identical tool call:

   ```
   B/D/E: { kind: 'shell', fullCommandText: 'echo …', intention: 'Echo proof of life string',
            commands: [{ identifier: 'echo …', readOnly: false }], canOfferSessionApproval: false }
   C:     { kind: 'hook', toolName: 'bash', toolArgs: '{"command":"echo …",…}' }
   ```

3. **The fix is to withhold the decision, not to change it.** The hook exists for its *side effect*
   (`FileSnapshotService.captureByPath`), not for its verdict. Returning `{}` keeps the side effect
   and lets the CLI's native permission flow run, delivering the full `shell`/`write` variant.

**Therefore:** `getSessionHooks()` omits `permissionDecision` when a forwarding permission handler is
installed, and keeps returning `'allow'` otherwise. Lane B's behaviour is untouched — dropping the
`'allow'` unconditionally would start prompting every VS Code user for approvals they have never
been asked for.

Incidental: `canOfferSessionApproval` was `false` on a bare `echo`, confirming it is a real signal
worth honouring rather than a field that is always `true`.
