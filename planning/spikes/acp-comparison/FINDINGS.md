# `copilot --acp` vs our ACP agent — measured, 2026-08-22

Both probed with the same battery (`spike-compare-upstream.mjs`), same CLI build (1.0.68),
same prompts. Raw profiles in `results/`.

## Verdict

**As a generic ACP agent, we are behind upstream on most axes and ahead on two.** The
differentiator I argued for — "plan mode that works over ACP" — **is false.** Upstream has a
Plan mode and emitted a `plan` update in the same run we did.

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

## What this means for the registry

**A registry entry now would be a near-duplicate that lags.** Upstream is at 1.0.80 in the registry
and auto-bumps hourly; we bundle 1.0.68 and would bump by hand. We would be shipping fewer prompt
capabilities, fewer modes, no auth block, and two extra methods nobody asked for.

**What the ACP work actually bought** is unchanged and still substantial: the v4.0 process boundary
is proven, and the agent is a second independent consumer of `SDKSessionManager` that has already
found two real defects the sidebar could not (`ModelCapabilitiesService` never initialised when the
provider is injected; `session/list` offering plan halves as conversations).

Those were the reasons to build it. "Ship it to Zed users" was not, and this measurement says so.
