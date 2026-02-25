# Granular Permission Handler

Target: 4.1

## Problem/Opportunity

The SDK (0.1.26+) has an `onPermissionRequest` handler that fires for every tool operation, providing operation-level detail (shell command text, file paths, read-only flags). We currently pass `approveAll` because our tool-level policies (`availableTools`, `--yolo`, `allowTools`/`denyTools`) handle the coarse gating.

But there are two gaps:

1. **User work sessions** lack fine-grained control. Users can configure `allowTools`/`denyTools` at the tool level, but can't say "allow bash but only for read-only commands" or "allow MCP server X but deny write operations."

2. **Plan mode** completely blocks bash via `availableTools`. A permission handler could allow bash in plan mode while restricting it to read-only operations, which would make planning significantly more useful (the AI could run `git log`, `grep`, `cat`, `ls` but not `rm`, `npm install`, or file-writing redirections).

## Current State (3.3.0)

Three separate layers, all working independently:

| Layer | Granularity | What it controls |
|-------|------------|-----------------|
| `availableTools` | Tool-level | Which tools the AI can see/use |
| `--yolo` + `allowTools`/`denyTools` | Tool-level | Which tools are auto-approved vs denied |
| `onPermissionRequest` | Operation-level | Whether a specific operation is allowed |

`onPermissionRequest` receives a `PermissionRequest` with these shapes (confirmed via spike):

```
kind: "shell"  → { fullCommandText, commands[].readOnly, hasWriteFileRedirection }
kind: "read"   → { path }
kind: "write"  → { path }  (assumed, not yet observed)
kind: "mcp"    → TBD
kind: "url"    → TBD
```

## Proposed Solution

### 1. User-configurable operation policies

Extend `copilotCLI` settings to support operation-level rules:

```jsonc
"copilotCLI.permissions": {
  "shell": "readOnly",   // allow bash, but only readOnly commands
  "write": "allow",      // allow file writes
  "read": "allow",       // allow file reads
  "mcp": "deny",         // block MCP tool calls
  "url": "allow"         // allow web fetches
}
```

Or keep it simple with a deny list:
```jsonc
"copilotCLI.denyOperations": ["shell:write", "mcp"]
```

The handler would check these rules before approving. Default behavior stays `approveAll` for backwards compatibility.

### 2. Smarter plan mode permissions

Replace the current plan mode approach (block bash entirely via `availableTools`) with:

- Allow bash in plan mode
- Permission handler approves `kind: "shell"` only when `commands.every(c => c.readOnly)` AND `hasWriteFileRedirection === false`
- Approve `kind: "read"` always
- Deny `kind: "write"` always
- Deny `kind: "mcp"` (or make configurable)

This gives the AI in plan mode access to: `git log`, `git diff`, `grep`, `cat`, `ls`, `find`, `wc`, `node -p` (readonly evals) while blocking: `rm`, `mv`, `npm install`, `git commit`, file redirections.

## Value

- **Plan mode becomes more useful** — the AI can read the codebase with bash, not just the limited `view`/`glob`/`grep` tools
- **Users get finer control** — "I want bash but not destructive commands" is a common need
- **Aligns with SDK direction** — the permission layer exists for a reason; using it properly future-proofs us

## Rough Scope

- `createPermissionHandler(config, mode)` factory function
- Map `PermissionRequest.kind` to user config settings
- Plan mode logic: approve read-only shell, deny writes
- Settings schema update for `copilotCLI.permissions`
- Tests for each policy combination

## Dependencies

- SDK 0.1.26+ (already on 0.1.26 as of 3.3.0)
- Understanding of `kind: "write"`, `kind: "mcp"`, `kind: "url"` shapes (need additional spike — we only observed `shell` and `read` in the permission spike)

## Open Questions

- Should denied operations show a notification to the user, or silently deny (letting the AI try alternatives)?
- Should plan mode permissions be hardcoded or user-configurable?
- Do we need a per-workspace permission config (like Claude's `.claude/settings.local.json`)?

## Notes

We're a VS Code extension, not a remote agent framework. The permission handler is interesting but not urgent — `approveAll` + `availableTools` covers all current use cases. This is a 4.1 polish item, not a blocker.
