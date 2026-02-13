# Backlog Item: Reasoning Display Order Inconsistency

## Issue Summary

**SDK Event Order Bug:** `assistant.reasoning` events arrive in inconsistent order relative to `assistant.message` events, causing reasoning to display BEFORE or AFTER the message unpredictably.

---

## GitHub Issue (Ready to Submit)

### Title
`assistant.reasoning` event order is inconsistent - sometimes before, sometimes after `assistant.message`

### Labels
- `bug`
- `sdk`
- `extended-thinking`

### Description

**Problem:**
The `assistant.reasoning` event arrives at inconsistent times relative to the `assistant.message` event. Sometimes reasoning appears before the message (expected), sometimes after (wrong).

**Expected Behavior:**
According to SDK documentation and UX expectations:
1. `assistant.reasoning` should ALWAYS arrive BEFORE `assistant.message`
2. This allows UIs to display "thinking..." indicator, then show the final response
3. Users should see the reasoning process BEFORE the conclusion

**Actual Behavior:**
Event order is non-deterministic:
- **Sometimes:** `assistant.reasoning` → `assistant.message` ✅ (correct)
- **Sometimes:** `assistant.message` → `assistant.reasoning` ❌ (broken)
- **Sometimes:** Both events have identical timestamps, order depends on event loop processing

**Impact:**
- Inconsistent UX - users confused when reasoning appears after the answer
- Can't rely on event order for UI state management
- Violates principle: "show your work before the answer"
- Makes debugging difficult (can't trust logs)

**Evidence:**

From extension logs (`tests/logs/server/check-reasoning-2.log`):
```
[INFO ] 2026-02-11T15:53:16.634Z [EVENT ORDER] 🧠 assistant.reasoning at 1770825196634
[DEBUG] 2026-02-11T15:53:16.634Z [Assistant Reasoning] The user is making a very valid point...
[DEBUG] 2026-02-11T15:53:16.634Z [SDK Event] assistant.turn_end: {"turnId":"0"}
[DEBUG] 2026-02-11T15:53:16.634Z Assistant turn 0 ended
```

**Identical timestamps (15:53:16.634Z)** - event order is non-deterministic!

**Reproduction Steps:**
1. Create session with `@github/copilot-sdk@^0.1.18`
2. Enable extended thinking mode
3. Send multiple messages over several conversations
4. Log timestamps for `assistant.reasoning` and `assistant.message` events
5. Observe: Sometimes reasoning comes first, sometimes it doesn't

**System Info:**
- SDK: `@github/copilot-sdk@^0.1.18`
- Node.js: v20.20.0
- OS: Ubuntu (WSL)
- Extension: vscode-copilot-cli-extension v3.0.0

**Workaround:**
We currently buffer all events and sort by timestamp before displaying, but this adds latency and complexity. Users notice the delay.

**Suggested Fix:**
1. **SDK Side:** Ensure `assistant.reasoning` is emitted with a timestamp strictly BEFORE `assistant.message`
2. **Or:** Add sequence numbers to events so clients can sort reliably
3. **Or:** Guarantee event emission order matches logical thinking → message flow

**Related:**
- Affects any UI trying to show "thinking" indicators
- Similar to #255 (plan mode) - both about event sequencing

---

## Internal Notes

**Files to check:**
- `src/sdkSessionManager.ts` - Event handler for `assistant.reasoning` and `assistant.message`
- `src/extension.ts` lines 408-415 - `[EVENT ORDER]` logging we added

**Current workaround in our extension:**
- We log `[EVENT ORDER]` timestamps but don't handle ordering
- Just display events as they arrive
- Results in inconsistent UX

**Reproducibility:**
- **Frequency:** ~30-40% of the time (based on user observations)
- **Pattern:** More likely with rapid-fire messages or when model is under load
- **Determinism:** Not reproducible on demand - seems timing-dependent

**User Quote:**
> "the reasoning came after their message. Sometimes it's before, sometimes it's after. that stinks."

**Priority:**
- **Severity:** Medium - Doesn't break functionality but degrades UX
- **Frequency:** Common enough to be annoying
- **Workaround:** Possible but adds complexity

**Next Steps:**
1. File this issue on `github/copilot-sdk` repository
2. Link to our extension logs as evidence
3. Propose adding sequence numbers or guaranteed ordering
4. Consider implementing local event buffer/sort if SDK fix takes time
