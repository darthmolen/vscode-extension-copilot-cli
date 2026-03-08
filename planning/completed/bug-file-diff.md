# Bug Report: Diff Display Shows Empty "Before" State

**Status**: 🔴 Active Bug  
**Severity**: High (Core feature broken)  
**Affects**: File snapshot/diff functionality for edit/create tools  
**Discovered**: 2026-02-15

## Problem Description

When clicking "View Diff" for an edited file (e.g., `plan.md`), VS Code's diff viewer shows:
- **Left side (Before)**: Empty or diagonal lines (file doesn't exist)
- **Right side (After)**: All content marked as additions (green `+` signs)

**Expected behavior**: Left side should show file content BEFORE the edit, right side should show AFTER.

**Screenshot**: `tests/output/diff-wrong.png`

## Evidence

### Log Location
**Server log**: `tests/logs/server/diff-wrong.log`

### Key Log Entries

```log
[INFO] 2026-02-15T23:42:46.493Z [FileSnapshot] Captured snapshot: 
  /home/smolen/.copilot/session-state/03aec30a-2b35-4d82-a3b9-761070093f72/plan.md -> 
  /tmp/copilot-cli-snapshots-nMBR1h/toolu_vrtx_017u1qdwJ2L1BbbgohXCsahY-1771198966493-plan.md

[DEBUG] 2026-02-15T23:42:46.810Z [SDK Event] tool.execution_complete: {"toolCallId":"toolu_vrtx_017u1qdwJ2L1BbbgohXCsahY","success":true,...}

[INFO] 2026-02-15T23:42:58.744Z View diff requested from UI: {
  "type":"viewDiff",
  "data":{
    "type":"diffAvailable",
    "toolCallId":"toolu_vrtx_017u1qdwJ2L1BbbgohXCsahY",
    "beforeUri":"/tmp/copilot-cli-snapshots-nMBR1h/toolu_vrtx_017u1qdwJ2L1BbbgohXCsahY-1771198966493-plan.md",
    "afterUri":"/home/smolen/.copilot/session-state/03aec30a-2b35-4d82-a3b9-761070093f72/plan.md",
    "title":"plan.md (Before ↔ After)",
    "diffLines":[
      {"type":"add","text":"# Plan: v3.0.0 Release Preparation"},
      {"type":"add","text":""},
      {"type":"add","text":"## Problem Statement"},
      ...
    ],
    "diffTruncated":true,
    "diffTotalLines":361
  }
}
```

### File System Evidence

```bash
$ ls -lh /tmp/copilot-cli-snapshots-nMBR1h/toolu_vrtx_017u1qdwJ2L1BbbgohXCsahY-1771198966493-plan.md
-rw-r--r-- 1 smolen smolen 0 Feb 15 17:42 /tmp/.../plan.md
                            ^
                            ZERO BYTES!
```

**The snapshot file exists but is completely empty** (0 bytes).

## Root Cause Analysis

### The Race Condition

**Timeline of Events**:
1. `23:42:46.493` - SDK fires `tool.execution_start` event
2. `23:42:46.493` - Extension calls `captureFileSnapshot()` (line 553 in `sdkSessionManager.ts`)
3. `23:42:46.493` - `fs.copyFileSync()` executes (line 71 in `fileSnapshotService.ts`)
4. **BUT**: SDK has **already started modifying the file** by this point!
5. Result: `copyFileSync` copies an empty or partially-written file

### Code Location: `src/sdkSessionManager.ts`

**Lines 540-558** - `handleToolStart()` method:

```typescript
private handleToolStart(event: any): void {
    try {
        const data = event.data;
        const eventTime = Date.now();
        
        const state: ToolExecutionState = {
            toolCallId: data.toolCallId,
            toolName: data.toolName,
            arguments: data.arguments,
            status: 'running',
            startTime: eventTime,
            intent: this.lastMessageIntent,
        };

        this.toolExecutions.set(data.toolCallId, state);

        // ❌ BUG: Snapshot captured AFTER tool execution has started!
        this.fileSnapshotService.captureFileSnapshot(data.toolCallId, data.toolName, data.arguments);

        this._onDidStartTool.fire(state);
    } catch (error) {
        this.logger.error(`[SDK Event] Error in handleToolStart: ${error instanceof Error ? error.message : error}`);
    }
}
```

### Code Location: `src/extension/services/fileSnapshotService.ts`

**Lines 64-73** - Snapshot capture logic:

```typescript
if (existedBefore) {
    // Create temp file with original content
    const fileName = path.basename(filePath);
    const timestamp = Date.now();
    tempFilePath = path.join(this.tempDir, `${toolCallId}-${timestamp}-${fileName}`);
    
    // ❌ BUG: File is already being modified by SDK when this runs!
    fs.copyFileSync(filePath, tempFilePath);
    
    this.logger.info(`[FileSnapshot] Captured snapshot: ${filePath} -> ${tempFilePath}`);
}
```

### Why This Happens

**The SDK fires `tool.execution_start` AFTER the tool has already begun executing**, not before!

The event flow is:
1. AI sends tool request with `edit` tool
2. **SDK starts executing the edit tool** (file modification begins)
3. SDK fires `tool.execution_start` event
4. Extension receives event and tries to snapshot
5. Too late - file is already modified/empty/locked

This is a **fundamental timing issue** with relying on `tool.execution_start` for pre-execution snapshots.

## Impact

- ❌ All file diffs show empty "before" state
- ❌ Users cannot review what was actually changed
- ❌ Makes the diff feature completely non-functional
- ❌ Breaks trust in the extension's change tracking

## Proposed Solutions

### Option 1: Capture on `assistant.message` Event

**When**: As soon as AI sends tool requests (before SDK executes them)  
**How**: 
1. Listen to `assistant.message` event
2. Parse `toolRequests` array for `edit`/`create` tools
3. **Immediately** capture snapshots for all mentioned files
4. SDK executes tools (snapshots already safe)

**Pros**:
- Snapshots captured at the right time (before execution)
- No race conditions
- Works with existing SDK architecture

**Cons**:
- Snapshots captured even if tool execution fails
- Need to parse tool arguments to extract file paths

**Implementation location**: Add new handler in `sdkSessionManager.ts`:

```typescript
private handleAssistantMessage(event: any): void {
    const data = event.data;
    
    // Pre-capture snapshots for all edit/create tools
    if (data.toolRequests) {
        for (const toolRequest of data.toolRequests) {
            if (toolRequest.name === 'edit' || toolRequest.name === 'create') {
                const filePath = toolRequest.arguments?.path;
                if (filePath) {
                    // Capture snapshot NOW, before SDK executes
                    this.fileSnapshotService.captureFileSnapshot(
                        toolRequest.toolCallId,
                        toolRequest.name,
                        toolRequest.arguments
                    );
                }
            }
        }
    }
}
```

### Option 2: Custom Tool Override

**When**: Replace SDK's built-in `edit` tool with our own  
**How**:
1. Register custom `edit` tool in `availableTools`
2. Capture snapshot in custom handler
3. Call original edit logic
4. Return result

**Pros**:
- Complete control over tool execution timing
- No reliance on SDK events

**Cons**:
- Complex implementation
- Need to replicate SDK's edit logic
- Might break with SDK updates

### Option 3: File System Watcher ⭐ **RECOMMENDED**

**When**: Monitor files for changes and snapshot on first write  
**How**:
1. Set up `fs.watch()` on workspace
2. On file change event, check if snapshot exists
3. If not, capture from backup/previous state

**Pros**:
- Guaranteed to catch changes
- Works regardless of SDK event timing
- No dependency on SDK event ordering
- Catches changes from any source (not just SDK tools)

**Cons**:
- High overhead (watches entire workspace)
- Still might miss the "before" state if write is atomic
- Doesn't work for new file creation

## Recommendation

**Implement Option 3** - File System Watcher provides the most robust solution.

Set up file watchers that trigger snapshots before any file modifications occur, independent of SDK event timing.

## Test Plan

After implementing the fix:

1. **Manual test**:
   - Send message that edits a file
   - Click "View Diff" button
   - Verify left side shows original content
   - Verify right side shows modified content

2. **Automated test** (add to `tests/file-snapshot-service.test.js`):
   ```javascript
   it('should capture snapshot before tool execution', async () => {
       // Simulate assistant.message with edit tool request
       // Verify snapshot exists and has correct content
       // Execute tool
       // Verify snapshot unchanged
       // Verify diff shows correct before/after
   });
   ```

3. **Edge cases**:
   - File doesn't exist (create tool)
   - File is read-only
   - File is very large
   - Multiple edits in quick succession

## Related Files

- `src/sdkSessionManager.ts` - Event handlers, snapshot capture trigger (line 553)
- `src/extension/services/fileSnapshotService.ts` - Snapshot logic (lines 45-103)
- `src/chatViewProvider.ts` - Diff button and viewDiff handler
- `tests/logs/server/diff-wrong.log` - Debug logs showing the race condition
- `tests/output/diff-wrong.png` - Visual evidence of the bug

## Questions for Review

1. **Is `assistant.message` guaranteed to fire before tool execution?** (Need to verify SDK behavior)
2. **Do we need to handle tool execution failures?** (If snapshot exists but tool fails, cleanup?)
3. **Should we add telemetry** to measure snapshot success rate?
4. **Performance impact** of pre-snapshotting all files in tool requests?

---

**Next Steps**:
1. Verify `assistant.message` event timing with SDK documentation
2. Implement Option 1 fix
3. Write comprehensive tests
4. Test with multiple file types and scenarios
5. Update COPILOT.md with lessons learned about SDK event timing
