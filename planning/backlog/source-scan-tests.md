# Backlog: Source-scan tests assert text, not behaviour

> **A source scan reporting a fact that is not true about the code — measured, 2026-08-22.**
>
> `tests/unit/extension/sdk-switch-model.test.js` matches
> `/export interface StatusData \{([\s\S]*?)\}/` and then asserts the captured body contains
> `'model?: string'`. `[\s\S]*?` is non-greedy, so it stops at the **first** `}` after the opening
> brace. Today there is none until the interface ends, so it captures 825 characters and passes.
>
> Lane A then added a field with a JSDoc comment containing `${...}`. The first `}` is now inside that
> comment, the capture truncates to 405 characters, and the test fails claiming `StatusData` has no
> `model` field — on an interface that plainly has one, after a **correct** change.
>
> This is the best argument in this file. The usual case against source scans is that they cannot
> fail for a real reason. This one is worse: it fails for a fake reason and names a defect that does
> not exist, sending the next reader to look for a field that is right there. Lane A replaced it with
> behavioural tests on `feature/4.0-in3-acp-server`; when that merges, this file leaves
> `KNOWN_SOURCE_READERS` and the count goes 15 → 14.

## Problem

**Fifteen** test files read production files with `fs.readFileSync` and assert that the *text*
contains a string — counted from `KNOWN_SOURCE_READERS`, not estimated. (Earlier drafts said "around
twenty"; a crude `grep` in a commit message said seventeen. Both were wrong, which is its own small
argument for counting from the gate.) They verify nothing a comment could not satisfy, and they break on refactors that
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

### Done 2026-08-22 — the gate, and six more files

**The gate exists**: `tests/unit/meta/no-new-source-scans.test.js`. A ratchet, not a sweep. It walks
`tests/**`, flags any file that reads a path under `src/`, and fails **two ways** — a file not on the
known list is the pile regrowing; a file on the list that no longer offends must be taken off. The
second direction is the point: the list cannot go stale, and the only way through is down.

It found four offenders a hand-written grep had missed, and one instructive false positive — it
flagged `file-snapshot-hooks.test.js`, which reads only temp files and mentions `src/` **in a
comment**. The gate was committing the exact defect it exists to catch, so it strips comments before
matching. Recorded because it is the whole thesis in miniature: a string match that cannot tell code
from prose is not a test.

Cleared in the same pass, taking the list from 20 files to **15**:

| File | Disposition |
| --- | --- |
| `model-default-on-start.test.js` | deleted — `sendAvailableModels` is covered behaviourally in `model-multiplier-pipeline`, the rest by the three `model-selector*` suites |
| `model-multiplier-pipeline.test.js` | one type scan removed; the behavioural router test it already had stays |
| `ensure-session-name-wired.test.js` | deleted — asserted *code ordering* by index arithmetic between two log-string landmarks; edit a log message and it breaks |
| `start-new-session-planning.test.js` | scan block removed, pure-function tests kept |
| `model-switch-rpc.test.js` | two scan blocks removed, five behavioural router tests kept |
| `sidebar-view-migration.test.js` | six `src/*.ts` scans removed; `package.json` and CSS assertions kept |

**The worst one found was not a text match.** Both tests in `start-new-session-planning`'s resume-safety
block were shaped `if (fnMatch) { assert.ok(...) }` — so when the regex failed to find the function at
all, **the test passed silently**. Rename either handler and the guard evaporates without a word. The
property they gestured at — resuming must not silently enter plan mode — is real, is now asserted
nowhere, and needs a live session rather than a regex; it belongs in the live-verification list.

**Two categories are legitimate and stay**, which is what the allowlist is for: `package.json`
assertions (the manifest *is* the contract with VS Code, and there is no runnable alternative short of
launching it) and CSS breakpoints (JSDOM does not apply stylesheets, and a silently dropped media
query is a real regression). Both are annotated in the gate with the reason.

**Next up:** `sdk-upgrade-0126.test.js` (11), `streaming-rpc-flow.test.js` (7),
`plan-mode-duplicate-tools.test.js` (7), `suppress-broken-sentence-bubble.test.js` (6), and the
remainder of the fifteen.

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

## The part worth fixing: there is no gate

These were **already prohibited in writing** — `CLAUDE.md` carries the rule with a worked example —
and they kept being written anyway, by AI, in sessions with that file loaded. Every removal so far
happened because a refactor broke them or because someone hunted them deliberately. Neither is
enforcement, and prose has now visibly failed at it twice.

The arithmetic is the problem: a source scan passes on its first run and never flakes, so it reads as
a cheap green test, while a behavioural test costs more and can fail. Under any pressure to move, the
cheap one wins.

**Proposal: make it fail.** A single test that walks `tests/**` and fails when a test file reads a
path under `src/` and then asserts on the result — with an explicit allowlist for the handful of
legitimate fixture reads. Roughly thirty lines, runs in the suite everyone already runs, and turns a
rule nobody enforces into a red run. Worth doing *with* the cleanup rather than after it, so the pile
cannot regrow while the long tail is still being worked through.

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
