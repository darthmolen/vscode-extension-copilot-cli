# Test Suite

## Quick Start

```bash
# Run all mocha tests (unit + integration)
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Run e2e tests (require SDK/compile)
npm run test:e2e:plan-mode
npm run test:e2e:session
```

## Directory Structure

```
tests/
  unit/                          # Fast, isolated tests
    components/                  # Webview component tests (MessageDisplay, InputArea, etc.)
    utils/                       # Utility function tests (buffered-emitter, error-boundaries, etc.)
    extension/                   # Extension-side tests (RPC, plan-mode tools, diff handling, etc.)

  integration/                   # Tests that wire multiple components together
    webview/                     # Webview integration (main.js handlers, event bus, diff flow, etc.)
    session/                     # Session management (resume, circuit breaker, error classification)
    plan-mode/                   # Plan mode integration (acceptance, button bugs, forwarding)
    sidebar/                     # Sidebar view migration tests

  e2e/                           # End-to-end tests requiring Copilot SDK (run via node, not mocha)
    plan-mode/                   # SDK plan mode workflows (.mjs files)
    session/                     # SDK session lifecycle, MCP integration

  helpers/                       # Shared test utilities
    jsdom-setup.js               # Basic JSDOM environment (createTestDOM/cleanupTestDOM)
    jsdom-component-setup.js     # Full component JSDOM with polyfills (MutationObserver, rAF, etc.)
    vscode-mock.js               # VS Code API mock for extension-side tests
    scenarios.js                 # Test scenario definitions
    authUtils.js                 # Auth error classification helpers (CJS)
    authUtils.mjs                # Auth error classification helpers (ESM)
    verify-setup.js              # Environment verification script
```

## Test Runners

| Directory | Runner | Command |
|-----------|--------|---------|
| `unit/` | Mocha + Chai | `npm run test:unit` |
| `integration/` | Mocha + Chai | `npm run test:integration` |
| `e2e/` | Node (standalone) | `node tests/e2e/<path>` |

**Why two runners?** Unit and integration tests run in mocha for speed and standard reporting. E2e tests require the Copilot SDK (`@anthropic-ai/sdk`) which needs a live session, so they run as standalone node scripts.

## Writing Tests

### Unit/Integration (mocha)

```javascript
const { expect } = require('chai');

describe('MyComponent', () => {
  it('should do the thing', () => {
    // arrange, act, assert
    expect(result).to.equal(expected);
  });
});
```

### Component tests needing JSDOM

```javascript
const { setupComponentDOM, cleanupComponentDOM } = require('../../helpers/jsdom-component-setup');

describe('MyComponent', () => {
  let dom, document, cleanup;

  beforeEach(() => {
    ({ dom, document, cleanup } = setupComponentDOM());
  });

  afterEach(() => cleanup());
});
```

### Extension-side tests needing VS Code mock

```javascript
const vscode = require('../../helpers/vscode-mock');
```
