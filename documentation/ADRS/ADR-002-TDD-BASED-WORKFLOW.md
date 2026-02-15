# ADR-002: TDD-Based Development Workflow

**Status**: Accepted
**Date**: 2026-01-30 (v2.0.x, formalized in v3.0)
**Driver**: Copilot CLI with Sonnet 4.5 was making frequent mistakes and forgetting previous work due to context size limitations, causing regressions with every new feature.

## Context

By v2.0, the extension had grown past the point where we could trust the AI to generate correct code on the first pass. Copilot CLI using Sonnet 4.5 was making a lot of mistakes or missing features — probably due to context size. The LLM would implement a feature correctly, then break it two turns later when working on something else. Cross-contamination and cross-cutting concerns were constant problems.

We had no safety net. When the AI "forgot" and broke something — which happened regularly — we had no way to detect the regression until we manually tested. By then, three other things had also broken. The feedback loop was too slow and too manual.

The first test suite (commit `60b6454`, Jan 25 2026) was an LLM-as-judge evaluation approach — testing the extension's behavior by having another AI judge the output. This was creative but unreliable. Flaky by nature, slow to run, and impossible to debug when assertions failed.

What we needed was deterministic, fast, and atomic: write the test first, watch it fail, make it pass, move on. The AI can't "forget" a requirement if the test is already written and failing.

## Decision

**Adopt strict TDD (Red-Green-Refactor) as the mandatory development workflow for all features and bug fixes.**

The workflow:

1. **RED** — Write a failing test that specifies the expected behavior
2. **GREEN** — Write the minimum code to make the test pass
3. **REFACTOR** — Clean up without breaking the test

Every feature and every bug fix starts with a test. The AI writes the test first. The test fails. Then the AI writes the implementation. The test passes. This is non-negotiable.

### Verification Pipeline

Every change runs this full pipeline:

```bash
npm test                    # Unit + integration (Mocha, 710+ tests)
npx tsc --noEmit            # Type checking
./test-extension.sh         # Build VSIX package
```

### Test Architecture

Tests are organized by confidence level:

```text
tests/
├── unit/           # Fast, isolated, no external dependencies
│   ├── components/ # Webview component tests (JSDOM)
│   ├── extension/  # Extension logic tests
│   └── utils/      # Utility tests
├── integration/    # Multiple components wired together
│   ├── webview/    # UI integration (JSDOM)
│   ├── session/    # Session lifecycle
│   └── plan-mode/  # Plan mode workflows
├── e2e/            # End-to-end with real SDK (manual)
└── helpers/        # Shared mocks and setup
```

### Framework Choice

Mocha + Chai, not Jest. VS Code's extension test infrastructure is Mocha-based. Fighting that creates friction. JSDOM provides DOM testing without a browser.

## Consequences

**Positive:**

- Regressions caught immediately — the AI can break things, but the tests catch it before it compounds
- Tests serve as executable documentation of expected behavior
- The AI writes better code when constrained by a failing test (it has a clear, atomic goal)
- 710+ tests across 91 files provide high confidence for refactoring
- TDD forced componentization — you can't TDD a 2,500-line monolith, so the code had to be broken apart (see ADR-004)

**Negative:**

- Slower initial development — writing the test first adds time per feature
- The AI sometimes writes tests that pass for the wrong reason (testing implementation, not behavior)
- Test maintenance cost increases with codebase size
- JSDOM doesn't perfectly replicate browser behavior — some webview bugs only appear in the real extension

## Notes

- The pre-existing `main.js size constraint` failure in integration tests is expected and not a regression — documented in project memory
- TDD was the forcing function for the 3.0 component extraction. When we tried to write tests for the monolithic `main.js`, we couldn't isolate anything. That's when we knew the architecture had to change.
- The earliest tests (commit `60b6454`) used LLM-as-judge evaluation. These were replaced with deterministic Mocha tests during the v3.0 refactor (commit `d4780a6`)
