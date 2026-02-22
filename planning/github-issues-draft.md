# GitHub Issues — Filed 2026-02-22

## Issues Filed

| # | Repo | Title | Status | Link |
|---|------|-------|--------|------|
| 1 | copilot-cli | Breaking change: --headless --stdio removed without deprecation | OPEN | [#1606](https://github.com/github/copilot-cli/issues/1606) |
| 2 | copilot-sdk | CLI v0.0.410+ auto-update breaks all SDK versions | OPEN | [#530](https://github.com/github/copilot-sdk/issues/530) |
| 3 | copilot-sdk | Node SDK: getBundledCliPath() breaks in CJS bundles (VS Code extensions) | OPEN | [#528](https://github.com/github/copilot-sdk/issues/528) |
| 4 | copilot-sdk | SDK e2e tests never run against a real CLI binary in CI | OPEN | [#532](https://github.com/github/copilot-sdk/issues/532) |

## Comments Added

| Issue | Repo | What we added | Link |
|-------|------|---------------|------|
| #1574 | copilot-cli | Custom tools silently ignored — spike evidence | [comment](https://github.com/github/copilot-cli/issues/1574#issuecomment-3940880424) |
| #989 | copilot-cli | Tool ID mismatch confirmed + permission response format | [comment](https://github.com/github/copilot-cli/issues/989#issuecomment-3940880714) |
| #377 | copilot-sdk | Context: CLI broke SDK, not "universal SDK" request | [comment](https://github.com/github/copilot-sdk/issues/377#issuecomment-3940880905) |

## Upvoted

- [copilot-cli #1574](https://github.com/github/copilot-cli/issues/1574) — custom tools ignored in ACP

## Related Issues (existing, for monitoring)

| Issue | Repo | Title | Status |
|-------|------|-------|--------|
| [#989](https://github.com/github/copilot-cli/issues/989) | copilot-cli | ACP incorrect tool IDs in permission requests | OPEN |
| [#1574](https://github.com/github/copilot-cli/issues/1574) | copilot-cli | ACP agent ignores custom tools | OPEN |
| [#728](https://github.com/github/copilot-cli/issues/728) | copilot-cli | Model selection not reflected in responses | OPEN |
| [#377](https://github.com/github/copilot-sdk/issues/377) | copilot-sdk | ACP support request (wontfix) | CLOSED |
| [#137](https://github.com/github/copilot-sdk/issues/137) | copilot-sdk | No minimum CLI version docs | OPEN |
| [#411](https://github.com/github/copilot-sdk/issues/411) | copilot-sdk | Override built-in tools (PR #522 pending) | OPEN |

## ACP Spike Scripts

Testing harness and spike scripts live on the `feature/4.0-acp-migration` branch:

- `tests/harness/acp-spike.mjs` — full ACP protocol spike (model, events, cancel, attachments, tools, MCP)
- `tests/harness/connection-test.mjs` — diagnostic harness that proved `--headless` removal
- `planning/in-progress/v4.0-acp-migration-plan.md` — full v4.0 plan with all spike findings
