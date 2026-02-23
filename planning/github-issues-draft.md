# GitHub Issues — Filed 2026-02-22

Updated 2026-02-23 with spike findings and corrections.

## Key Finding (2026-02-23)

**`--headless --stdio` was never removed.** The CLI binary is a thin Go launcher that
delegates to downloaded versions in `~/.copilot/pkg/universal/`. Without `--no-auto-update`,
the launcher silently runs a newer version at runtime — causing the version drift we observed.
SDK v0.1.23+ (PR #392, Steve Sanderson) passes `--no-auto-update`. Our SDK v0.1.22 does not.

We corrected #1606 and #530 with this finding. Our workaround: `cliArgs: ['--no-auto-update']`.

## Issues Filed

| | # | Repo | Title | Status | Link |
|---|---|------|-------|--------|------|
| + | 1 | copilot-cli | Breaking change: --headless --stdio removed without deprecation | OPEN | [#1606](https://github.com/github/copilot-cli/issues/1606) |
| + | 2 | copilot-sdk | CLI v0.0.410+ auto-update breaks all SDK versions | OPEN (needs-info) | [#530](https://github.com/github/copilot-sdk/issues/530) |
| + | 3 | copilot-sdk | Node SDK: getBundledCliPath() breaks in CJS bundles (VS Code extensions) | PR SUBMITTED | [#528](https://github.com/github/copilot-sdk/issues/528) → [PR #546](https://github.com/github/copilot-sdk/pull/546) |
| x | 4 | copilot-sdk | SDK e2e tests never run against a real CLI binary in CI | CLOSED | [#532](https://github.com/github/copilot-sdk/issues/532) |
|   | 5 | copilot-cli | [Security] ACP lacks session-level tool permission primitives | OPEN | [#1607](https://github.com/github/copilot-cli/issues/1607) |

Legend: `x` = resolved/closed, `+` = we added follow-up comments, blank = open, no action needed

### Issue Notes

**#1606** — Our original claim (--headless removed) was wrong. Posted correction (Feb 23)
acknowledging the error, explaining the launcher delegation behavior, and offering to close.
Still waiting for CLI team response.

**#530** — Steve Sanderson (Feb 23) pushed back on our claims. We responded with evidence:
the launcher delegates to `~/.copilot/pkg/universal/` at runtime, SDK <= v0.1.22 lacks
`--no-auto-update`, and his `^0.0.411` resolves to 0.0.411 not 0.0.414 as he stated.
Acknowledged his PR #392 fix is correct.

**#528** — PR submitted: [#546](https://github.com/github/copilot-sdk/pull/546). Replaces `import.meta.resolve`
with `createRequire` + path walking, adds CJS bundled output, conditional exports. Awaiting Steve's review.

**#532** — Closed by Steve (Feb 23). He acknowledged a gap in auto-downloader E2E testing
but rejected the broader claim. Would need a narrower re-file to pursue.

**#1607** — No response. Triage label only.

## Comments Added

| | Issue | Repo | What we added | Date | Link |
|---|-------|------|---------------|------|------|
| + | #1606 | copilot-cli | Correction: --headless not removed, explained launcher delegation | Feb 23 | [comment](https://github.com/github/copilot-cli/issues/1606#issuecomment-3946451605) |
| + | #530 | copilot-sdk | Evidence: launcher behavior, SDK version boundary, semver question | Feb 23 | [comment](https://github.com/github/copilot-sdk/issues/530#issuecomment-3946437228) |
|   | #1574 | copilot-cli | Custom tools silently ignored — spike evidence | Feb 22 | [comment](https://github.com/github/copilot-cli/issues/1574#issuecomment-3940880424) |
|   | #989 | copilot-cli | Tool ID mismatch confirmed + permission response format | Feb 22 | [comment](https://github.com/github/copilot-cli/issues/989#issuecomment-3940880714) |
|   | #377 | copilot-sdk | Context: CLI broke SDK, not "universal SDK" request | Feb 22 | [comment](https://github.com/github/copilot-sdk/issues/377#issuecomment-3940880905) |

## Upvoted

- [copilot-cli #1574](https://github.com/github/copilot-cli/issues/1574) — custom tools ignored in ACP

## Related Issues (existing, for monitoring)

| | Issue | Repo | Title | Status | Maintainer Response |
|---|-------|------|-------|--------|---------------------|
|   | [#989](https://github.com/github/copilot-cli/issues/989) | copilot-cli | ACP incorrect tool IDs in permission requests | OPEN | None (3 community confirmations) |
|   | [#1574](https://github.com/github/copilot-cli/issues/1574) | copilot-cli | ACP agent ignores custom tools | OPEN | None |
|   | [#728](https://github.com/github/copilot-cli/issues/728) | copilot-cli | Model selection not reflected in responses | OPEN | andyfeller (Dec 2025, cosmetic) |
| x | [#377](https://github.com/github/copilot-sdk/issues/377) | copilot-sdk | ACP support request (wontfix) | CLOSED | friggeri closed as wontfix |
|   | [#137](https://github.com/github/copilot-sdk/issues/137) | copilot-sdk | No minimum CLI version docs | OPEN | None (dormant since Jan 23) |
| + | [#411](https://github.com/github/copilot-sdk/issues/411) | copilot-sdk | Override built-in tools | OPEN | **Steve willing to implement** (Feb 12) |

## Maintainer Engagement Summary

**Steve Sanderson** (copilot-sdk) is the active maintainer. Responded Feb 23 on #530, #528, #532.
Open to PRs on CJS (#528) and tool override (#411). Key contact for SDK improvements.

**copilot-cli team** — Zero maintainer engagement on any of our issues (#1606, #1607).
The `ACP` label on #989 suggests manual categorization but no comments.

## ACP Spike Scripts

Testing harness and spike scripts live on the `feature/4.0-acp-migration` branch:

- `tests/harness/acp-spike.mjs` — full ACP protocol spike (model, events, cancel, attachments, tools, MCP)
- `planning/spikes/cli-auto-update/` — auto-update verification experiments (Feb 23)

## Spike Results (2026-02-23)

CLI version sweep (all versions tested with `--no-auto-update`):

| Version | `--headless` | `--acp` | Binary Size |
|---------|-------------|---------|-------------|
| 0.0.403 | TIMEOUT (accepted) | YES | 138,480,832 |
| 0.0.409 | TIMEOUT (accepted) | YES | 138,677,440 |
| 0.0.410 | TIMEOUT (accepted) | YES | 138,677,440 |
| 0.0.411 | TIMEOUT (accepted) | YES | 138,742,976 |
| 0.0.414 | TIMEOUT (accepted) | YES | 138,742,976 |

- `--headless` is accepted on all versions (TIMEOUT = needs auth, not flag rejection)
- `--acp` works on all versions, even 0.0.403
- Auto-update delegation: without `--no-auto-update`, v0.0.403 reports as v0.0.410 at runtime
