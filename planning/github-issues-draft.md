# GitHub Issues — Filed 2026-02-22

Updated 2026-02-23 with spike findings and corrections.
Updated 2026-02-23 (evening) — #530 closed, PR #546 has review feedback from Steve.
Updated 2026-02-24 — #1606 self-closed, PR #546 reworked per Steve's feedback, SDK breaking changes discovered.

## Key Finding (2026-02-23)

**`--headless --stdio` was never removed.** The CLI binary is a thin Go launcher that
delegates to downloaded versions in `~/.copilot/pkg/universal/`. Without `--no-auto-update`,
the launcher silently runs a newer version at runtime — causing the version drift we observed.
SDK v0.1.23+ (PR #392, Steve Sanderson) passes `--no-auto-update`. Our SDK v0.1.22 does not.

We corrected #1606 and #530 with this finding. Our workaround: `cliArgs: ['--no-auto-update']`.

## SDK Breaking Changes (0.1.22 → 0.1.26)

Our extension is on SDK **0.1.22**. Latest is **0.1.26**. Two breaking changes landed:

1. **PR #509** (v0.1.25, Feb 18) — Permissions denied by default. Must pass `onPermissionRequest`.
2. **PR #554** (merged Feb 24) — `onPermissionRequest` is now **required** on `createSession()`
   and `resumeSession()`. Omitting it throws. SDK exports `approveAll` convenience helper.

Other changes since 0.1.22:
- `--no-auto-update` baked in (can remove our `cliArgs` workaround)
- `clientName` option on `SessionConfig` (identifies app in UA headers)
- CLI dep bumped to 0.0.414
- Node engine requirement changed to 20+
- MCP env vars fix (`envValueMode: direct`)

**Upgrade is required for v3.3.0.** See `planning/v3.3.0-plan.md` (TBD).

## Issues Filed

| | # | Repo | Title | Status | Link |
|---|---|------|-------|--------|------|
| x | 1 | copilot-cli | Breaking change: --headless --stdio removed without deprecation | CLOSED (self, Feb 24) | [#1606](https://github.com/github/copilot-cli/issues/1606) |
| x | 2 | copilot-sdk | CLI v0.0.410+ auto-update breaks all SDK versions | CLOSED | [#530](https://github.com/github/copilot-sdk/issues/530) |
| + | 3 | copilot-sdk | Node SDK: getBundledCliPath() breaks in CJS bundles (VS Code extensions) | PR REWORKED, AWAITING REVIEW | [#528](https://github.com/github/copilot-sdk/issues/528) → [PR #546](https://github.com/github/copilot-sdk/pull/546) |
| x | 4 | copilot-sdk | SDK e2e tests never run against a real CLI binary in CI | CLOSED | [#532](https://github.com/github/copilot-sdk/issues/532) |
|   | 5 | copilot-cli | [Security] ACP lacks session-level tool permission primitives | OPEN (no response) | [#1607](https://github.com/github/copilot-cli/issues/1607) |

Legend: `x` = resolved/closed, `+` = we added follow-up comments, blank = open, no action needed

### Issue Notes

**#1606** — **CLOSED (Feb 24).** Our original claim (--headless removed) was wrong. Posted
correction (Feb 23) with launcher delegation evidence. CLI team never responded. Self-closed
as "not planned" since the underlying issue (auto-update drift) was fixed in SDK v0.1.23.

**#530** — **CLOSED.** Steve replied "Thanks for confirming" and closed after our evidence
about launcher delegation and `--no-auto-update`. Resolution: our workaround (`cliArgs`) is correct,
SDK v0.1.23+ has the fix upstream. No further action.

**#528 / PR #546** — **Reworked per Steve's feedback (Feb 24).** Original dual CJS+ESM approach
rejected. New approach: single ESM build unchanged, `getBundledCliPath()` falls back to
`__filename`-based path resolution when `import.meta.url` is unavailable (shimmed CJS).
Net diff from main: 2 files (`src/client.ts` fix + `test/cjs-compat.test.ts`).
Awaiting Steve's re-review.

**#532** — Closed by Steve (Feb 23). He acknowledged a gap in auto-downloader E2E testing
but rejected the broader claim. Would need a narrower re-file to pursue.

**#1607** — No response. Triage label only. Leaving open — security issues should stay until addressed.

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

**Steve Sanderson** (copilot-sdk) — Most active contributor on SDK issues. Responded Feb 23
on #530, #528, #532. Reviewed PR #546 — wants single ESM build with CJS fallback. Open to
tool override (#411). Shipped two breaking changes in quick succession (permissions deny-by-default
Feb 18, required handler Feb 24). Very active pace — monitor SDK releases closely.

**copilot-cli team** — Zero maintainer engagement on any of our issues (#1606, #1607) or
community-confirmed bugs (#989, #1574). `triage` labels are being applied (someone reads them)
but no comments, no assignments, no follow-through. The pattern (active SDK community vs silent
CLI team) suggests a resourcing or prioritization gap on the CLI side.

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
