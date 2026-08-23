# Spike — tool events in an extension-created session

**Run:** 2026-08-17 · `node probe-events.js <session-id>` · **Verdict: P2's §7.1 blocker is cleared, with three corrections.**

The review blocked P2 because its evidence came from a session the Copilot CLI produced in a
terminal, while extension-created sessions run **our** plan-mode custom tools. If those logged
differently, the reader would be built on the wrong shape.

## Sessions probed

| Session | Why it counts | Result |
| --- | --- | --- |
| `af36eb01-…-plan` | **Extension-created.** Plan mode is our feature; this session was started by the extension at 09:59:35 on 2026-08-17 and ran our registered custom tools | 38 starts / 38 completes / **38 joined** |
| `81c4a813-…` | Sub-agent traffic, for contrast | 38 / 38 / **38 joined**, 27 `agentId`-tagged |

Our custom tools appear exactly like built-ins: `plan_bash_explore`×8, `update_work_plan`×3,
`present_plan`×2, alongside `view`, `grep`, `glob`, `skill`.

## What holds

- **The join works.** Every start had a matching complete in both sessions; zero orphans either way.
- **Every field is under `data`.** `toolCallId` appeared at the top level **zero** times, in both
  sessions. The reader must read `event.data.toolCallId`, never `event.toolCallId`.
- **`success` is a real boolean**, `true` and `false` both observed.
- `agentId` sits at the **event** level, not under `data` — unlike everything else.

## Three corrections to the plan

1. **`error` exists on failed completes, and the plan never mentioned it.** A failure carries
   `{ message, code }` and `result: null`:

   ```
   keys:    error, interactionId, model, success, toolCallId, turnId
   error:   {"message": "Command failed: ls planning/needs-review/in-progress/*.md …", "code": "failure"}
   result:  null
   ```

   So a replayed failed tool can say *why* it failed, not merely that it did. §5.2 should map
   `data.error.message` alongside `success → error`.

2. **`parentToolCallId` exists on sub-agent tool events** (session `81c4a813`, both start and
   complete). Sub-agent tools are not just `agentId`-tagged — they carry a link to the spawning call.
   Not needed for flat-chip replay, but it is the field IN-7 ("arbitrary sub-agent nesting depth")
   would be built on, and it should not be discovered twice.

3. **The key set varies by tool type.** `shellToolInfo` appears only where shell tools ran (present in
   `81c4a813`, absent throughout the plan session); `parentToolCallId` only under sub-agents;
   `error` only on failures. **The reader must not assume a fixed key set** — read the fields it
   needs, ignore the rest.

## One assumption the review made that does not hold

§7.1 implied extension-created sessions could be told apart by `producer`. They cannot: **every**
session probed reports `producer: "copilot-agent"`, because that is the CLI labelling itself
regardless of who spawned it. The `-plan` session is identifiable as ours only because plan mode is
our feature. If future work needs to distinguish hosts, `producer` is not the field.

## Bearing on P2

- §7.1 no longer blocks: custom tools log identically to built-ins.
- §5.2 gains `data.error.message` for failed tools.
- §8.1's fixtures should include a **failed** tool (`success: false` with `error`) and a
  **plan-mode custom tool**, neither of which the original evidence covered.
