# SDK Spike Tool

General-purpose Copilot SDK experimentation tool. Run prompts, inspect events, analyze streaming, spike ideas.

## Quick Start

```bash
# Run all sub-agent streaming tests with streaming analysis
npm run test:spike:streaming

# Run a single prompt
node tests/harness/sdk-spike.mjs run tests/prompts/sub-agent-streaming/explore-authentication.md

# Interactive mode
npm run test:spike:interactive
```

## Architecture

```
tests/harness/
├── sdk-spike.mjs             # Main CLI entry point
├── prompt-loader.mjs         # Markdown+frontmatter parser
├── session-manager.mjs       # SDK session lifecycle
├── event-inspector.mjs       # Event capture & streaming analysis
├── reporters/
│   ├── console-reporter.mjs  # Human-readable terminal output
│   └── json-reporter.mjs     # Machine-readable JSON reports
└── README.md
```

## Commands

### `run <path>`

Run prompt files against the SDK.

```bash
# Run a directory of prompts
node tests/harness/sdk-spike.mjs run tests/prompts/sub-agent-streaming/

# Run a single prompt with all events
node tests/harness/sdk-spike.mjs run --events all tests/prompts/sub-agent-streaming/explore-authentication.md

# Streaming analysis with JSON report
node tests/harness/sdk-spike.mjs run --analyze-streaming --json tests/prompts/sub-agent-streaming/

# Filter by category
node tests/harness/sdk-spike.mjs run --category explore-agent tests/prompts/sub-agent-streaming/

# Verbose mode (show chunk content)
node tests/harness/sdk-spike.mjs run --verbose tests/prompts/sub-agent-streaming/
```

### `interactive`

Ad-hoc prompt entry for quick experiments.

```bash
node tests/harness/sdk-spike.mjs interactive
```

In-session commands:
- `/events` — Show last 20 captured events
- `/streaming` — Show streaming analysis
- `/summary` — Show event summary
- `/quit` — Exit

## Streaming Analysis

Detects sub-agent message batching by analyzing chunk timing:

**Smooth** (good): `avgDelta < 200ms`, `maxDelta < 1000ms`
```
Chunk 1: +150ms
Chunk 2: +180ms
Chunk 3: +170ms
→ Assessment: SMOOTH
```

**Batched** (bug): Long pauses followed by bursts
```
Chunk 1: +5200ms  ← sub-agent working
Chunk 2: +10ms    ← burst
Chunk 3: +8ms
→ Assessment: BATCHED
```

## Prompt Format

Prompts use markdown with YAML frontmatter. See `tests/prompts/README.md`.

## npm Scripts

```bash
npm run test:spike                 # Show help
npm run test:spike:streaming       # Run streaming analysis on all prompts
npm run test:spike:interactive     # Interactive mode
```

## Related

- Prompts: `tests/prompts/`
- Bug report: `documentation/issues/BACKLOG-SUBAGENT-MESSAGE-QUEUEING.md`
- SDK hooks: `documentation/COPILOT-SDK-HOOKS.md`
