# Auto-Model Spike — Findings

Run against SDK `@github/copilot-sdk@1.0.5` + bundled CLI `@github/copilot@1.0.68`, Node 24.13.1.
Script: `planning/spikes/auto-model/spike.mjs`.

## Q1 — Does `listModels()` return `auto`? YES

`auto` is the **first** entry returned by `client.listModels()`:

```json
{ "id": "auto", "name": "Auto",
  "capabilities": { "supports": {}, "limits": { "max_context_window_tokens": 0 } },
  "billing": { "discountPercent": 10 } }
```

- No `multiplier`, no `tokenPrices` — `auto`'s only billing signal is `discountPercent: 10`.
- So no synthetic injection is needed; `auto` flows through `getAvailableModels()` naturally.

### Full authoritative current model list (18, in listModels order)
`auto`, `claude-sonnet-5`, `claude-sonnet-4.6`, `claude-sonnet-4.5`, `claude-haiku-4.5`,
`claude-fable-5`, `claude-opus-4.8`, `claude-opus-4.8-fast`, `claude-opus-4.7`, `gpt-5.5`,
`gpt-5.4`, `gpt-5.3-codex`, `gpt-5.4-mini`, `gpt-5-mini`, `gemini-3.1-pro-preview`,
`gemini-3.5-flash`, `kimi-k2.7-code`, `mai-code-1-flash-picker`.

## Q2 — `createSession({ model: 'auto' })`? SUCCEEDS
- `rpc.model.getCurrent()` → `{ modelId: 'auto' }`.
- A real turn under `auto` server-routed to a concrete model (`gpt-5.3-codex` in this run).

## Q3 — `switchTo({ modelId: 'auto' })` mid-session? SUCCEEDS
- Returns `{ modelId: 'auto' }`.

## ⚠️ Breaking changes discovered in SDK 1.0.5 (beyond original plan)

### 1. `session.destroy()` removed → use `session.disconnect()`
`CopilotSession` no longer has `destroy()`; the disposal method is now `disconnect()`.
`check-types` did NOT catch this because our `session` is typed `any`.
Our call sites (must fix): `src/sdkSessionManager.ts:1322, 1559, 1734, 2004`.

### 2. `billing.multiplier` no longer populated → tier system breaks
`ModelBilling.multiplier` still exists in the type but is `undefined` for **every** model
returned by CLI 1.0.68. Models now carry `billing.tokenPrices` instead. Our dropdown's
Fast/Standard/Premium grouping and the `Nx` badges key off `multiplier`, so every model would
collapse into "Standard" with no badge.

`tokenPrices.outputPrice` (per-1M-token, integer) is a clean re-tiering signal:

| model | outputPrice |
|---|---|
| gpt-5-mini | 200 |
| kimi-k2.7-code | 400 |
| gpt-5.4-mini | 450 |
| mai-code-1-flash-picker | 450 |
| claude-haiku-4.5 | 500 |
| gemini-3.5-flash | 900 |
| claude-sonnet-5 | 1000 |
| gemini-3.1-pro-preview | 1200 |
| gpt-5.3-codex | 1400 |
| claude-sonnet-4.6 / 4.5 / gpt-5.4 | 1500 |
| claude-opus-4.8 / 4.7 | 2500 |
| gpt-5.5 | 3000 |
| claude-fable-5 / claude-opus-4.8-fast | 5000 |

Note: `multiplier` may still be populated for users on *premium-request* billing (vs. this
account's token-based billing), so the robust rule is: **use `multiplier` when present,
otherwise derive the tier from `tokenPrices.outputPrice`.**
