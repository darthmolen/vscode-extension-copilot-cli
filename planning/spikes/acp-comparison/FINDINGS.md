# `copilot --acp` vs our ACP agent — measured, 2026-08-22

Both probed with the same battery (`spike-compare-upstream.mjs`), same CLI build (1.0.68),
same prompts. Raw profiles in `results/`.

## Verdict

**As a generic ACP agent, we are behind upstream on most axes and ahead on a few.** The
differentiator first argued for — "plan mode that works over ACP" — **is false.** Upstream has a
Plan mode and emitted a `plan` update in the same run we did.

A second measurement (below) narrows this: upstream's Plan mode is **one session**, ours is two, and
context isolation is a real difference. It is a smaller claim than the original and a larger one than
this table alone supports.

## Side by side

| | `copilot --acp` | ours |
| --- | --- | --- |
| `authMethods` | ✅ terminal-auth, with a `_meta.terminal-auth` command block | ❌ **none** — blocks registry CI |
| `promptCapabilities` | image ✅, embeddedContext ✅ | all **false** |
| `mcpCapabilities` | http ✅, sse ✅ | not advertised |
| modes | **three** — Agent, Plan, **Autopilot** — with canonical ACP URI ids | two, bespoke `work`/`plan` string ids |
| `session/list` | ✅ | ✅ |
| `session/load` | ✅ | ✅ |
| `session/fork` | ❌ *Method not found* | ✅ |
| `session/close` | ❌ *Method not found* | ✅ |
| `plan` updates | 1 | 1 |
| diff content | 1 | 1 |
| permission forwarded | 1 | 1 |
| `usage_update` | none | 4 |
| `available_commands_update` / `config_option_update` | ✅ both | neither |
| version | auto-bumped hourly by the registry | ours, by hand |

## Where the probe was unfair to upstream

Recorded because scoring a competitor on your own bug is how you talk yourself into shipping.

- **`session/set_mode` ✗** — I sent `modeId: 'plan'`. Upstream's ids are canonical URIs
  (`…/session-modes#plan`), so it correctly rejected mine. Their set_mode works.
- **`session/load` ✗** — the error was *"Session … is already loaded"*, i.e. supported, and I
  called it on an open session.

Corrected, upstream's only real gaps against us are **`session/fork` and `session/close`**.

## The one difference that is genuinely ours, and it is on the security axis

For the same `echo` command:

```
upstream : title "Echo requested text"        options [allow_once, allow_always, reject_once]
ours     : title "Run: echo acp-compare"      options [allow_once, reject_once]
```

Two deliberate divergences, both defensible and both ours:

1. **Upstream titles the prompt with the model's `intention`; we title it with the command.**
   `intention` is model-authored prose. Ours cannot be talked into reading "Tidy up harmlessly"
   over an `rm -rf`.
2. **Upstream offered a session-wide grant where we withheld one.** The CLI reported
   `canOfferSessionApproval: false` for this command and we honoured it; upstream offered
   `allow_always` anyway. Ours grants less than the user could be tricked into granting.

Neither is a feature anyone shops for. Both are the kind of thing that matters once.

## Follow-up: is their Plan mode a second session? (measured separately)

Prompted by the right question — advertising a Plan mode and *running a second session* are
different claims, and the table above only measured the first. `spike-plan-mode-shape.mjs` measures
the second, on disk rather than through the protocol.

```
dirsCreatedByEnteringPlanMode : []
dirsCreatedByPlanPrompt       : []
sessionId                     : unchanged throughout
planMdInSessionDir            : true
```

**Upstream's Plan mode is one session.** No second directory is created entering it or prompting in
it, the session id never changes, and `plan.md` is written into that same session's folder. The CLI
does not juggle sessions.

### The claim this spike nearly made, and did not

The plan-mode turn called **`apply_patch`** — a write tool, in a mode called Plan, after a prompt
saying *"do not change any files."* That reads as a restriction failure.

It is not. `git status` on the repo afterwards: **untouched.** `apply_patch` is how it wrote
`plan.md`, which is exactly what our own `update_work_plan` tool does. **No claim is made here that
upstream's plan mode is unsafe**, because the evidence does not support one.

Recorded because the first version of this document made a confident claim from a tool name and it
would have been wrong — the same failure mode as reading a type declaration and stopping there.

### The difference that is real, with the bill it comes with

| | upstream | ours |
| --- | --- | --- |
| sessions | **one** | **two** — `<id>` and `<id>-plan` |
| planning context | shares the work transcript | a separate conversation |
| plan artifact | `plan.md` in the session dir | `plan.md` in the **work** session's dir |
| accept / reject | not observed | accept injects a kickoff message; reject rolls back |
| tool restriction | not measured; writing `plan.md` is permitted | 13-entry whitelist, six custom tools |

The user-facing property that is genuinely ours: **planning exploration does not pollute the work
session's context.** Ours can survey a repository across dozens of turns and hand over only the plan.

**And the cost is ours too.** Two sessions is what produces the 197 `-plan` halves that broke
`session/list` this morning, and what P4 exists to clean up. A design with a bill, not a free win.

## What this means for the registry

**A registry entry now would be a near-duplicate that lags.** Upstream is at 1.0.80 in the registry
and auto-bumps hourly; we bundle 1.0.68 and would bump by hand. We would be shipping fewer prompt
capabilities, fewer modes, no auth block, and two extra methods nobody asked for.

**What the ACP work actually bought** is unchanged and still substantial: the v4.0 process boundary
is proven, and the agent is a second independent consumer of `SDKSessionManager` that has already
found two real defects the sidebar could not (`ModelCapabilitiesService` never initialised when the
provider is injected; `session/list` offering plan halves as conversations).

Those were the reasons to build it. "Ship it to Zed users" was not, and this measurement says so.
