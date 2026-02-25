# Permission Interaction Spike — Findings

Date: 2026-02-24
SDK: 0.1.26, CLI: auto-updated (latest), Node: v24.13.1

## Key Findings

### 1. `--yolo` does NOT suppress `onPermissionRequest`

Both S1 (--yolo) and S2 (no --yolo) received exactly 1 permission request for the same `shell` operation. The handler fires regardless of `--yolo`.

**Implication**: `--yolo` controls CLI-side behavior (auto-approve internally), but the SDK's `onPermissionRequest` is a separate layer. We MUST always provide a handler.

### 2. `PermissionRequest` shapes by kind

**`kind: "shell"`**:
```json
{
  "kind": "shell",
  "toolCallId": "tooluse_xxx",
  "fullCommandText": "node -p \"require('./package.json').version\"",
  "intention": "Get version from package.json",
  "commands": [{"identifier": "node -p ...", "readOnly": false}],
  "possiblePaths": [],
  "possibleUrls": [],
  "hasWriteFileRedirection": false,
  "canOfferSessionApproval": false
}
```

**`kind: "read"`**:
```json
{
  "kind": "read",
  "toolCallId": "tooluse_xxx",
  "intention": "Read file: /path/to/file",
  "path": "/home/smolen/dev/vscode-copilot-cli-extension/package.json"
}
```

### 3. Denying a permission causes the AI to try alternatives

S3 denied `shell`, and the AI retried with `grep` (kind: `read`). The CLI correctly respected the denial and didn't execute the bash command.

### 4. `availableTools` + `onPermissionRequest` work independently

S4 restricted tools to `[view, glob, grep]`. The AI used `view` (not `bash`), and still got a `kind: "read"` permission request. The handler fires even for whitelisted tools.

### 5. Node version requirement

CLI's auto-updated version requires `node:sqlite` (Node 22.5+). Our Node 20 minimum will need updating, or we need to pin the CLI version. `--no-auto-update` doesn't help if the version in `~/.copilot/pkg/` was already updated.

## Permission Handler Design Decision

Since `--yolo` doesn't suppress the handler, our handler must ALWAYS approve operations. The decision:

- **`approveAll`** is the correct approach for 3.3.0
- `--yolo` and `availableTools` handle the policy at the CLI level
- The `onPermissionRequest` handler is a SDK-level gate that must approve for the CLI to proceed
- A future policy-aware handler (B-4) would only deny operations the CLI shouldn't have offered — but since `availableTools` already prevents those, `approveAll` is sufficient

This simplifies B-4: we don't need a custom handler. We just need `approveAll` + correct `--yolo` logic.
