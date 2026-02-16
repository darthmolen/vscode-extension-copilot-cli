# Test Prompts

Reusable prompt files for manual testing, the SDK spike tool, and documentation.

## Format

Each prompt is a markdown file with YAML frontmatter:

```markdown
---
id: unique-identifier
category: test-category
timeout: 60000
expectedBehavior:
  - What should happen
bugSymptoms:
  - What indicates a bug
---

The actual prompt text to send to the SDK.
Multi-line, human-readable.
```

## Available Prompt Suites

### `sub-agent-streaming/`

Tests sub-agent message streaming behavior (v3.0.1 focus).

| Prompt | Category | Timeout | Purpose |
| ------ | -------- | ------- | ------- |
| `explore-authentication.md` | explore-agent | 60s | Auth code exploration |
| `explore-test-files.md` | explore-agent | 45s | Test file discovery |
| `task-run-tests.md` | task-agent | 90s | Run test suite |
| `general-purpose-analysis.md` | general-purpose-agent | 120s | Architecture analysis |
| `code-review-recent-changes.md` | code-review-agent | 60s | Review MessageDisplay.js |
| `parallel-exploration.md` | multiple-agents | 120s | Parallel sub-agents |

**Usage with spike tool:**

```bash
# Run all streaming prompts
npm run test:spike:streaming

# Run one prompt
node tests/harness/sdk-spike.mjs run tests/prompts/sub-agent-streaming/explore-authentication.md

# Filter by category
node tests/harness/sdk-spike.mjs run --category explore-agent tests/prompts/sub-agent-streaming/
```

## Adding New Prompts

1. Create a `.md` file with YAML frontmatter (`id`, `category`, `timeout`)
2. Write the prompt body in plain markdown
3. Organize into a subdirectory by test suite
4. Add `expectedBehavior` and `bugSymptoms` for automated analysis

## Categories

- `explore-agent` — Codebase exploration and search
- `task-agent` — Command execution and task running
- `general-purpose-agent` — Multi-step complex tasks
- `code-review-agent` — Code analysis and review
- `multiple-agents` — Parallel sub-agent execution
- `streaming` — Message streaming behavior
- `tool-execution` — Built-in tool usage
- `session-management` — Session lifecycle
- `error-handling` — Error recovery scenarios

## Related

- Spike tool: `tests/harness/`
- Bug reports: `documentation/issues/`
