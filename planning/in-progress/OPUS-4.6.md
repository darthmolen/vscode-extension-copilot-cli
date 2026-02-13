# Add Claude Opus 4.6 Model Support

**Date:** 2026-02-12
**Status:** TODO
**Priority:** Low (enhancement, not blocking Phase 1)

---

## What

Add `claude-opus-4.6` to the model selection enums in `package.json` so users can select it from the VS Code settings dropdown.

## Changes Required

**File:** `package.json`

Add `"claude-opus-4.6"` to both enum arrays:

1. `copilotCLI.model` enum (line ~172)
2. `copilotCLI.planModel` enum (line ~194)

Also update the default model description if desired (currently says `claude-sonnet-4.5`).

## Current Model List

```
claude-sonnet-4.5
claude-haiku-4.5
claude-opus-4.5
claude-sonnet-4
gpt-5.2-codex
gpt-5.1-codex-max
gpt-5.1-codex
gpt-5.2
gpt-5.1
gpt-5
gpt-5.1-codex-mini
gpt-5-mini
gpt-4.1
gemini-3-pro-preview
```

## Known Issues

- **Silent fallback bug:** `copilot --model claude-opus-4.6` may silently fall back to the default model instead of erroring. Tracked at https://github.com/github/copilot-cli/issues/1332
- **Gating:** May require `experimental: true` in Copilot config. There was an undocumented `staff` flag gating access, but this should be resolved now that opus-4.6 went GA on Feb 5, 2026.
- **Plan requirements:** Available to Pro, Pro+, Business, and Enterprise users. Enterprise/Business admins must explicitly enable the Claude Opus 4.6 policy in Copilot settings.
- **Fast mode preview pricing:** 9x premium request multiplier (promotional pricing through Feb 16, 2026).

## Sources

- [Supported AI models in GitHub Copilot](https://docs.github.com/en/copilot/reference/ai-models/supported-models)
- [Claude Opus 4.6 GA announcement (Feb 5, 2026)](https://msftnewsnow.com/claude-opus-4-6-github-copilot-agentic-coding/)
- [Silent fallback issue](https://github.com/github/copilot-cli/issues/1332)
