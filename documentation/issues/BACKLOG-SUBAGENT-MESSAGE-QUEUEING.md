# Backlog Item: Sub-Agent Message Queueing Issue

## Issue Summary

**SDK Message Handling Bug:** When CLI enters sub-agent mode, `message_modified` events are queued instead of merged into the sub-agent's output stream, resulting in choppy message delivery.

---

## GitHub Issue (Ready to Submit)

### Title
Sub-agent messages are queued instead of merged, causing choppy streaming

### Labels
- `bug`
- `sdk`
- `streaming`
- `ux`

### Description

**Problem:**
When the Copilot CLI enters sub-agent mode (e.g., using `task` tool to dispatch specialized agents), the message streaming behavior degrades significantly. Instead of merging sub-agent output into the main stream, the SDK appears to queue `message_modified` events and deliver them in batches.

**Expected Behavior:**
When a sub-agent is working:
1. Main agent shows "dispatching sub-agent..." message
2. Sub-agent output streams smoothly in real-time
3. Messages merge seamlessly into the conversation
4. User sees continuous progress updates

**Actual Behavior:**
When a sub-agent is working:
1. Main agent shows "dispatching..." message
2. Sub-agent output is queued/buffered
3. Messages arrive in chunks/bursts instead of smoothly
4. User experience is choppy and feels laggy

**Comparison to Claude:**
- **Claude Desktop:** Sub-agent output merges smoothly in real-time
- **GitHub CLI SDK:** Sub-agent output arrives in batches/queues

**Impact:**
- Poor UX - appears frozen or laggy
- Users can't see real-time progress
- Feels less responsive than native Claude
- Defeats the purpose of streaming

**Reproduction Steps:**

1. Create session with `@github/copilot-sdk@0.1.22`
2. Send message that triggers sub-agent dispatch (e.g., ask to run tests)
3. Observe message stream behavior
4. Compare to Claude Desktop's smooth streaming
5. Or run automated: `npm run test:spike:streaming` (see `tests/harness/` for spike tool)

**Evidence:**

Automated streaming analysis on SDK 0.1.22 (2026-02-15) — all 6 test prompts show BATCHED delivery:

| Prompt | Category | Duration | Chunks | Avg Delta | Max Delta | Pauses >5s | Bursts <50ms | Assessment |
| ------ | -------- | -------- | ------ | --------- | --------- | ---------- | ------------ | ---------- |
| code-review-recent-changes | code-review-agent | 34.8s | 127 | 460ms | 34,304ms | 1 | 74 | BATCHED |
| explore-authentication | explore-agent | 35.9s | 104 | 452ms | 34,535ms | 1 | 77 | BATCHED |
| explore-test-files | explore-agent | timeout | 19 | 2,147ms | 36,437ms | 1 | 16 | BATCHED |
| general-purpose-analysis | general-purpose-agent | timeout | 122 | 254ms | 12,816ms | 2 | 91 | BATCHED |
| parallel-exploration | multiple-agents | timeout | 205 | 291ms | 47,344ms | 1 | 165 | BATCHED |
| task-run-tests | task-agent | timeout | 169 | 64ms | 9,498ms | 1 | 152 | BATCHED |

**Pattern:** Long pause (9-47s) while sub-agent works, then a burst of chunks at <50ms intervals. This confirms queueing rather than real-time streaming.

User report: "apparently when the cli goes into sub-agent mode, it queue's the message_modified events instead merging them into the sub-agent, which sucks. that's definitely not as good as claude."

**System Info:**

- SDK: `@github/copilot-sdk@0.1.22`
- Node.js: v20.20.0
- OS: Ubuntu (WSL)
- Extension: vscode-copilot-cli-extension v3.0.0

**Suggested Fix:**
1. Ensure `message_modified` events for sub-agents are emitted immediately, not queued
2. Merge sub-agent output into parent message stream in real-time
3. Add `message.source: 'subagent'` metadata if needed for UI differentiation
4. Match Claude's smooth streaming behavior

**Related:**
- Similar to issue #255 (plan mode) - both about event handling and UX
- May be related to reasoning order bug (identical timestamps suggesting event batching)

---

## Internal Notes

**Observed Pattern:**
- Main agent message appears
- Long pause (sub-agent working)
- Burst of updates all at once
- Repeat

**User Expectation:**
- Continuous stream like Claude Desktop
- Real-time progress visibility
- Smooth, responsive UI

**Priority:**
- **Severity:** Medium - Affects UX but doesn't break functionality
- **Frequency:** Every time sub-agents are used (common with `task` tool)
- **Workaround:** None - SDK behavior

**Next Steps:**
1. File issue on `github/copilot-sdk` repository
2. Request streaming improvement for sub-agent messages
3. Consider local buffering/smoothing if SDK fix takes time
