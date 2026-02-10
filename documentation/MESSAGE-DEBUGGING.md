# Message Tracking & Debugging

## Overview

Added comprehensive message tracking to both extension and webview RPC routers to detect message runaways and identify missing awaits.

## What Was Added

### Extension Side (`ExtensionRpcRouter.ts`)

**Counters:**
- `incomingMessageCount` - Total messages from webview
- `outgoingMessageCount` - Total messages to webview  
- `messageCountByType` - Map of message types → counts (prefixed with `IN:` or `OUT:`)
- `REPORT_INTERVAL` - Log stats every 100 messages

**Automatic Logging:**
- Every 100 incoming messages → logs stats to console
- Every 100 outgoing messages → logs stats to console
- Shows total counts, time since last report, breakdown by type (sorted by frequency)

**Manual Inspection:**
```typescript
// If needed, you can call this anytime in the extension:
const stats = rpcRouter.getMessageStats();
console.log(stats);
```

### Webview Side (`WebviewRpcClient.js`)

**Same counters and behavior:**
- Tracks messages in both directions (webview perspective)
- Logs every 100 messages with `[MESSAGE DEBUG - WEBVIEW]` prefix
- Provides `getMessageStats()` method for manual inspection

## What to Look For

### Normal Behavior
- Message counts should grow slowly during conversation
- Incoming/outgoing should be roughly balanced (within ~50%)
- Types like `streamChunk` will be frequent during responses
- `init`, `ready` should be low counts

### Red Flags
- **Runaway:** Same message type hitting hundreds/thousands in seconds
- **Imbalance:** 1000+ incoming but only 10 outgoing (or vice versa)
- **Tight loops:** Reports every few milliseconds instead of spread out
- **Unexpected types:** High counts of messages that shouldn't be frequent

### Common Culprits
- Missing `await` in async handlers → duplicate sends
- Event listeners not disposed → handlers called multiple times
- Recursive message sends → ping-pong between webview/extension
- DOM event handlers firing too frequently → spam messages

## Where to Find Logs

**Extension logs:**
- VS Code → View → Output → "Copilot CLI" channel
- Look for `[MESSAGE DEBUG]` lines

**Webview logs:**
- VS Code → Help → Toggle Developer Tools
- Console tab
- Look for `[MESSAGE DEBUG - WEBVIEW]` lines

## Testing

After installing the new VSIX:
1. Open Copilot CLI panel
2. Send a few messages
3. Check Output channel for extension stats
4. Check DevTools console for webview stats
5. Look for any immediate red flags

## Example Output

```
================================================================================
[MESSAGE DEBUG] INCOMING Message Stats
Total incoming: 100
Total outgoing: 47
Time since last report: 1234ms
Breakdown by type:
  IN:sendMessage: 3
  IN:ready: 1
  IN:switchSession: 2
  ...
================================================================================
```

If you see something like:
```
Total incoming: 500
Total outgoing: 500
Time since last report: 50ms  ← ⚠️ TOO FAST!
Breakdown by type:
  IN:sendMessage: 500  ← ⚠️ RUNAWAY!
```

That's your smoking gun! 🔫
