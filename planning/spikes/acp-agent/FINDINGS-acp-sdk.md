# Spike: does `@agentclientprotocol/sdk` serve the agent side?

**Run:** 2026-08-16 · **Script:** [`spike-acp-sdk-agent.mjs`](spike-acp-sdk-agent.mjs) · **Verdict: 12/12**
**SDK:** `@agentclientprotocol/sdk@1.3.0` — Apache-2.0, **zero dependencies**

Companion to [FINDINGS.md](FINDINGS.md), which proved the manager runs out-of-host. This one asks
what we should *build on* now that it does.

## Headline: IN-3's scope item 1 largely disappears

The ticket assumed we hand-roll NDJSON JSON-RPC framing and port the gotchas from
`tests/harness/acp-spike.mjs`. **The protocol authors publish a TypeScript SDK whose agent half is
exactly our surface.** Hand-rolling a protocol whose authors ship a zero-dependency implementation
is not defensible, so the transport work collapses into configuration.

> **`@zed-industries/agent-client-protocol` is deprecated** — npm says *"renamed to
> @agentclientprotocol/sdk"*. It last published 2025-10; the live package published 2026-07. Anyone
> following an older tutorial will install the dead one.

## What the spike settled that the docs could not

### 1. In-process `connect()` is our test seam

`clientApp.connect(agentApp)` returns a working connection **with no transport, no subprocess, no
pipes** — the SDK's own docstring calls it *"useful for tests and in-process examples."*

This substantially defuses the circularity risk we had planned around: a hand-written harness only
confirms *our* reading of the spec, but the SDK's `ClientApp` is the protocol authors' reading. Zed
remains valuable as an end-to-end check; it is no longer the only thing standing between us and a
protocol misread.

### 2. Cancellation is an `AbortSignal`, not a notification to correlate

A request handler receives `{ params, requestId, signal, client }`. `session/cancel` surfaces as
`signal`. Nothing to match up by hand.

Note this is **ergonomics, not a different wire format** — the ACP wire still carries cancel as a
notification, which is what `tests/harness/acp-spike.mjs` had to handle manually against
`copilot --acp`. The SDK wraps it for agent authors.

### 3. Method names must come from `acp.methods`, not string literals

There is no `client.sessionUpdate()`. Notifications go through
`client.notify('session/update', …)`, which *looks* type-safe:

```ts
notify<Method extends ClientNotificationMethod>(method: Method, params: ClientNotificationParamsByMethod[Method]): Promise<void>;
notify<Params = unknown>(method: string, params?: Params): Promise<void>;   // ← swallows everything
```

The second overload matches any call, so when the first fails TypeScript falls through silently.
**Verified with `tsc --strict`, both compile clean:**

| Written | Result |
| --- | --- |
| `notify('session/updat', {…valid…})` — typo'd method | ✅ compiles |
| `notify('session/update', { nonsense: true })` — garbage params | ✅ compiles |

A typo does not fail the build; it fails at runtime, or worse, silently drops transcript messages.

**Superseded 2026-08-17 — the SDK already solves this, use `acp.methods`.** Once the SDK *source*
was added to `research/acp-sdk/`, its own example turned out never to use a string literal:

```ts
await cx.notify(acp.methods.client.session.update, { … });   // src/examples/agent.ts:98
```

`acp.methods.client.session.update === "session/update"`, and a typo on the **constant** is a
compile error — `TS2551: Property 'updat' does not exist… Did you mean 'update'?` — where the typo'd
**string** compiled clean. So the diagnosis above holds (raw literals are unchecked) but the
prescribed facade is unnecessary: **use the SDK's method constants everywhere and pass no literals.**

Also visible in `acp.methods.agent.session`: `new, load, list, delete, fork, resume, close, setMode,
setConfigOption, prompt, cancel`. Note **`fork`** — relevant to Lane B's Slice 3.

### 4. `initialize` is **not guaranteed to run** — default deny, upgrade on receipt

`buildSession(cwd).start()` issues `session/new` only. A real client sends `initialize` first, but
the SDK's own convenience path does not, so **our handlers must work having never been initialized.**

This is security-adjacent rather than cosmetic. `initialize` carries `clientCapabilities`, including
`fs: { readTextFile, writeTextFile }`, and the ACP schema's own default is
`{ readTextFile: false, writeTextFile: false }` — the protocol assumes nothing is supported until
told otherwise.

The natural implementation is the broken one:

```ts
private caps!: ClientCapabilities;                        // "set in initialize"
.onRequest('session/prompt', () => { if (this.caps.fs.readTextFile) … })   // 💥 undefined
```

Treat `initialize` as an **upgrade, never a precondition**:

```ts
private caps: ClientCapabilities = { fs: { readTextFile: false, writeTextFile: false } };
.onRequest('initialize', ({ params }) => { this.caps = { ...this.caps, ...params.clientCapabilities }; … })
```

**Why it matters for scope item 4 (permissions):** forwarding to `session/request_permission`
instead of the hardcoded `approveAll` must be conditional on client capability. Branching on an
unset capability does not usually crash — it silently falls back to auto-approve. That is the same
class of defect **cli#1607** is filed about on the Copilot side. Deny-by-default makes the safe path
the automatic one.

### 5. Module format: the agent is its own process, so ESM is fine

The SDK is `"type": "module"`, our extension compiles to CJS. Not a conflict — **an ESM agent
`require()`s our CJS `out/sdkSessionManager.js` and the S4 `CopilotClientProvider` successfully**
(steps 5a/5b). The agent never enters the extension's CJS bundle.

## The process lesson

**Three consecutive wrong guesses from the `.d.ts` alone** — `conn.initialize`, then
`conn.agent.initialize`, then `client.sessionUpdate`. Each looked right in the type declarations and
did not exist at runtime, because the typed surfaces (`ClientSideConnection`, `AgentContext`) are not
what `connect()` and the handler context actually hand you.

What worked was dumping the live object:

```js
const keys = o => [...new Set([...Object.keys(o), ...Object.getOwnPropertyNames(Object.getPrototypeOf(o) || {})])];
```

Had we skipped the spike and gone straight to TDD, those would have been three rounds of red tests
against a misremembered API — debugging our own mocks instead of the protocol.

**The deeper cause, fixed 2026-08-17: the SDK source was not in `research/`.** CLAUDE.md's SDK-First
rule says to read the SDK source before touching SDK behaviour, but only `copilot-sdk` was cloned
there, so for ACP there was nothing to read and the `.d.ts` was all we had. The source is now at
`research/acp-sdk/` (v1.3.0, matching the installed package) and **its `src/examples/agent.ts` alone
answers every one of the three wrong guesses**, plus the `acp.methods` correction above. Cloning it
took under a minute; not having it cost an afternoon and produced a wrong recommendation that reached
three documents.

## What this does not prove

- No real prompt was driven through `SDKSessionManager` yet; the agent handlers were stubs.
- Not tested against a **real** ACP client (Zed). The in-process client is the same SDK, so it shares
  any misreading the SDK itself has.
- Single platform (Linux), single run.
- `session/load`, `session/cancel` mid-stream, and permission forwarding are all untouched.

## Consequences for the plan

1. **Scope item 1 (transport) collapses** into "use the SDK, and pass method constants."
2. **New dependency:** `@agentclientprotocol/sdk`. This tripped the `worktree-init` symlink caveat —
   Lane A's `node_modules` was made independent before installing so Lane B was untouched.
3. **Two new invariants** for the implementation, both testable in-process before any CLI is
   involved: method constants over literals, and initialize-as-upgrade.
4. **Zed drops from "only honesty check" to "end-to-end confirmation."** Still worth doing, less
   urgent than when the SDK did not exist.
