# Backlog: Source-scan tests assert text, not behaviour

## Problem

Around twenty test files read production files with `fs.readFileSync` and assert that the *text*
contains a string. They verify nothing a comment could not satisfy, and they break on refactors that
are correct.

**Ten were deleted during v3.13.0 Task 7**, every one because a legitimate change stopped a string
matching:

| Deleted | Broke on |
| --- | --- |
| `extension.ts` contains `setCurrentModel` | the write moved onto the host that started the session (C1) |
| `chatViewProvider.ts` contains `sendAvailableModels` / `sendMessageDelta` / `sendReasoningDelta` / `onDidRequestSwitchModel` | the chat surface moved to `webviewChatSurface.ts` |
| `chatViewProvider.ts` contains `_view: vscode.WebviewView`, `.onDidChangeVisibility(`, `.focus` | container differences moved behind `ChatWebviewSlot` |
| `extension.ts` contains `chatProvider.show()` | a local was renamed to `sidebarSurface` |

Each cost time to diagnose — the failure says "assertion failed", not "this test was never testing
anything" — and each was replaced, where the behaviour mattered, by a test that runs it. The three
sidebar-view ones became `chat-webview-slot.test.js`, which asserts that revealing focuses the view
id, that visibility is forwarded, and that closing a sidebar slot does not end its surface. That last
property no string could have expressed.

CLAUDE.md already states the rule — *"Was the test matching against a string, comment, or dead
import? **Delete the test.** It was never verifying anything"* — and the v3.13.0 working agreements
record it again as **"Never source-scan in tests"**. The remaining files predate both.

## Current spread

Highest-density first, by count of `includes(` / `match(` / regex assertions over file text:

```
23  integration/webview/main-full-integration.test.js
19  unit/extension/streaming-backend.test.js
14  integration/webview/reasoning-delta-streaming.test.js
12  unit/extension/model-default-on-start.test.js
12  integration/sidebar/sidebar-view-migration.test.js
11  unit/extension/sdk-upgrade-0126.test.js
10  unit/extension/model-switch-rpc.test.js
```

…and roughly a dozen more with one to seven each. **Not every `readFileSync` hit is a source scan** —
`session-service.test.js` and the plan-mode fixtures read *data* files, which is legitimate. This
needs triage, not a blanket sweep.

## Why it matters now

These are a **tax on exactly the work in flight**. P3 deletes the module-level `sessionManager`, moves
ten verbs onto `ChatSessionHost` and rewrites five RPC handlers — a diff that will break a further
crop of these for no reason connected to correctness. The 34-line global deletion will trip anything
matching on `sessionManager`.

The second cost is quieter and worse: **they inflate the count.** A suite of 2054 reads as strong
coverage while some fraction of it cannot fail for a real reason. Of the defects found during
v3.13.0, the ones that mattered came from reading code or from a live run — not from this suite.

## Scheduled

**Decided 2026-08-21: the top three files are cleared *before* v3.13.0 P3 starts.** P3 step 3 deletes
34 lines mentioning `sessionManager`; clearing first means a red run during P3 means something. The
long tail stays opportunistic.

### Done 2026-08-21 — the top three

| File | Was | Now |
| --- | --- | --- |
| `integration/webview/main-full-integration.test.js` | 11 scans | **deleted** |
| `unit/extension/streaming-backend.test.js` | 19 scans | **11 behavioural tests** |
| `integration/webview/reasoning-delta-streaming.test.js` | 14 scans | **folded into the above, deleted** |

Suite 2054 → **2025**, three consecutive clean runs. The count fell by 29 and coverage rose, which is
the shape this work should always have.

- **`main-full-integration`** asserted `main.js` contains `new MessageDisplay(` and *lacks*
  `getElementById('messages')` — a completed migration's RED phase, left in place. All seven
  components it named have behavioural tests under `tests/unit/components/` (54 files), and the
  component-hierarchy rule it guarded is guarded properly by
  `MessageDisplay-tool-ownership.test.js`, which mounts the components and checks where the tool chip
  lands. CLAUDE.md's hierarchy section now names that file, so the rule points at its real guard.
- **`streaming-backend`** was the case that justified the whole rule. `assistant.message_delta` was
  covered by *nothing else* — deleting the scans would have left a live feature untested. Replaced
  with tests that drive `_handleSDKEvent` through a fake context, the pattern
  `subagent-events.test.js` established. They also cover two early returns the scans never saw: a
  sub-agent's delta must not reach the main bubble, and an empty reasoning delta must not cross the
  RPC boundary.
- **`reasoning-delta-streaming`** was the reasoning twin, and self-described as "(source-scan)". Its
  webview claims are covered by running them in `MessageDisplay-reasoning-streaming.test.js`; its
  manager and router halves moved into `streaming-backend.test.js`.

Both new suites use `tests/helpers/with-vscode-mock.js`, which restores
`Module.prototype.require`, rather than the module-scope patch that never restores. That is one fewer
contributor to the cross-file pollution tracked separately.

**Next up in this backlog:** `unit/extension/model-default-on-start.test.js` (12),
`integration/sidebar/sidebar-view-migration.test.js` (12) — both already partly gutted during Task 7
— and `unit/extension/sdk-upgrade-0126.test.js` (11).

## Proposed approach

Not a big-bang sweep. Three rules applied as each file is touched, plus one deliberate pass:

1. **Triage first.** Separate genuine source scans from legitimate fixture reads. Only the former are
   in scope.
2. **For each source scan, ask what behaviour it gestures at.** If the behaviour matters and is
   testable, write the behavioural test and delete the scan. If it is already covered, delete the
   scan. If it is untestable without an extension host, delete the scan and say so in a comment — an
   unrunnable assertion is worse than an acknowledged gap.
3. **Leave a note where a test is deleted**, naming what replaced it. The Task 7 deletions did this,
   and those comments are why a later reader can tell absence from oversight.
4. **Do the top three files as one pass before P3's global deletion**, so that work is not fighting
   them; take the long tail opportunistically.

## Value

Removes a category of failure that reads as a regression and is not one. Stops the coverage number
overstating what is checked. Clears the ground for P3's wide diff.

## Scope

Medium, and safely incremental — every step is a deletion or a replacement, so it can stop anywhere.
No production code changes. Expect the suite count to **fall**, which is the point.

## Related

`planning/backlog/test-suite-flake-cross-file-global-pollution.md` — a different test-suite problem,
worth reading alongside. Also worth re-checking: the suite gave **nine consecutive clean runs** on
2026-08-19, which that document says it never does. Either the flake is load-dependent in a way not
yet characterised, or something changed. One restoring `vscode` mock helper was added that day
(`tests/helpers/with-vscode-mock.js`), which is not enough on its own to explain it.
