---
type: plan
status: backlog
---

# Two findings from the PR #49 review, deferred rather than dropped

Both are real, both were verified, and both were left out of v4.0.0 because the fix is a different
shape from the rest of that batch. Replies on the PR name this file.

---

## 1. A panel closed mid-adoption still starts its session

**Where:** `ChatPanelService.adopt()` — the `panel.onDidDispose` handler is registered *before* the
two awaits below it (`loadTranscript`, then `ensureStarted`).

Close a restoring tab during that window and the dispose handler runs first: it detaches the surface,
releases the host and — with the wind-down in place — disposes it. When the await resumes, `adopt`
carries on and calls `ensureStarted()` on a host that is already gone from the registry. That attaches
a manager to a host nothing owns and nothing can reach: **a live CLI session with no surface, no
registry entry, and no wind-down**, for the life of the window.

**Why it is not in v4.0.0.** It needs cancellation threaded through `adopt` — a token set by the
dispose handler and checked after each await — which is a different change from the one-line
identity and ordering fixes that made up the rest of the batch. It also wants a test that can
interleave a disposal between two awaits, which the current panel-service fake cannot express.

**Shape of the fix:** an `adopted` flag or an `AbortSignal` on the adoption, set when the panel
disposes; every post-await step returns early if it is set, and the host is released rather than
started.

---

## 2. A tab's pinned active file does not survive a reload — and the README says it does

**Where:** `WebviewChatSurface.pinnedActiveFile` is surface-only state;
`src/webview/app/state/surfaceSessionState.js` persists `sessionId` and nothing else, so
`ChatPanelService.restore()` has no seed file to pass back.

**This one contradicts a claim we shipped.** `README.md` says the file you opened a tab on survives
the next reload, and `CHANGELOG.md` lists it under the release's "your choices are recorded" theme.
Right now the session comes back and the file binding does not.

**Either the persistence lands or the claim comes out**, and the persistence is the better answer:
the pin *is* the "intentional actions are treated intentionally" principle applied to a file, and
dropping it would be the third time a gesture in this codebase was honoured without being recorded.

**Why it is not in v4.0.0.** The serialized panel state is what VS Code hands back on restore, so
widening it changes the restore contract — including what happens when an older extension version
wrote state without the field, and when the pinned file no longer exists on disk. That deserves its
own change with its own tests, not a rider on a fix batch.

**Shape of the fix:** add `pinnedActiveFile` to the persisted state; `restore()` passes it to
`adopt()` as the existing `seedFile`; treat a missing or now-deleted path as no pin rather than an
error. When it lands, delete this section and leave the README claim standing.
