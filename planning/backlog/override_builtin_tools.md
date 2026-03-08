# Backlog: Use SDK Built-in Tool Override API

**SDK issue:** [copilot-sdk #411](https://github.com/github/copilot-sdk/issues/411) — closed/shipped
**Shipped in:** SDK v0.1.30 (Mar 3, 2026)
**Our SDK version:** 0.1.22 (upgrade needed)

---

## What Shipped

SDK v0.1.30 added `overridesBuiltInTool: true` on `defineTool()`:

```ts
import { defineTool } from "@github/copilot-sdk";

const session = await client.createSession({
  tools: [defineTool("grep", {
    overridesBuiltInTool: true,
    handler: async (params) => `CUSTOM_GREP_RESULT: ${params.query}`,
  })],
  onPermissionRequest: approveAll,
});
```

Without the flag, registering a tool with the same name as a built-in returns an error.

---

## Opportunities for This Extension

### 1. Plan Mode — Restrict Built-in Tools

Currently, plan mode uses `availableTools` whitelist to block dangerous tools. With the override API
we could instead **replace** built-in tools with no-op stubs that return a refusal message, giving
the AI clearer feedback when it tries to use a disallowed tool rather than the tool silently
not appearing.

```ts
// Instead of just omitting "bash" from availableTools:
defineTool("bash", {
  overridesBuiltInTool: true,
  handler: async () => "Tool not available in plan mode. Use plan_bash_explore instead.",
})
```

**Verdict:** Low priority. Current `availableTools` whitelist works fine. This would improve UX
for the AI (clearer error messages) but not for the user.

### 2. Custom Bash Wrapper for Telemetry / Logging

Could override `bash` to log all commands the AI runs, or add confirmation prompts for dangerous
patterns (e.g. `rm -rf`, `git push`).

**Verdict:** Medium priority. Useful for safety and auditability. Would require SDK upgrade first.

### 3. Custom `edit_file` / `read_file` for Active File Context

Could override `read_file` to automatically inject the active VS Code editor's content, or
`edit_file` to show an inline diff in the sidebar before applying.

**Verdict:** Medium priority. The inline diff feature is already partially built — this could
deepen it. Would need careful design to avoid breaking normal file edits.

---

## Prerequisites

- Upgrade SDK from 0.1.22 → 0.1.32 (latest as of Mar 8)
- SDK upgrade brings breaking changes (see `planning/github-issues-draft.md`):
  - `onPermissionRequest` is now required on `createSession()`/`resumeSession()`
  - `--no-auto-update` baked in (can remove our `cliArgs` workaround)
  - Node engine 20+ required

The SDK upgrade is the gating dependency for all of the above.

---

## Status

- [ ] Upgrade SDK to 0.1.32
- [ ] Evaluate which tool overrides are worth implementing
- [ ] Implement chosen overrides with TDD
