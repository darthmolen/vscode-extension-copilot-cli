---
type: reference
---

# Running our ACP agent in Zed

**Written:** 2026-08-22, from the first live run · **Verified against:** Zed 1.16.1, CLI 1.0.68,
WSL2 + WSLg.

Zed is the only third-party ACP host we have driven. It matters more than a demo: it is the one
check that reads the protocol independently of us, and it found two defects our own 36-assertion
wire harness could not. This is how to reproduce it.

> **The agent is not shipped.** `out/**` is `.vscodeignore`d and `esbuild.js` never builds
> `src/acp/main.ts`, so the entry point exists only after a **local compile**. Every path below is a
> working checkout, not an installed extension. See the packaging analysis in
> `planning/completed/v3.15.0-acp-release-declined.md` §3 for why that is deliberate.

---

## 1. Build the agent

```bash
cd /home/smolen/dev/vscode-copilot-cli-extension
npm install                 # needed once after a fresh clone — see §6
npm run compile-tests       # tsc → out/ . `npm run compile` does NOT build the agent
ls out/acp/main.js          # must exist
```

`compile-tests` is the one that matters. `npm run compile` runs esbuild, which bundles the
*extension* and knows nothing about `src/acp/`.

## 2. Install Zed (once)

```bash
curl -f https://zed.dev/install.sh | sh     # lands in ~/.local/bin
export PATH="$HOME/.local/bin:$PATH"
zed --version
```

## 3. Configure the agent

`~/.config/zed/settings.json`:

```jsonc
{
  "agent_servers": {
    "Copilot CLI Chat": {
      "type": "custom",
      "command": "/home/smolen/.nvm/versions/node/v24.13.1/bin/node",
      "args": [
        "/home/smolen/dev/vscode-copilot-cli-extension/out/acp/main.js",
        "--cli-path",
        "/home/smolen/dev/vscode-copilot-cli-extension/node_modules/@github/copilot-linux-x64/copilot"
      ],
      "env": {}
    }
  }
}
```

Three things that are not obvious:

- **Absolute path to `node`, always.** Node is nvm-managed, so it is not on `PATH` for a process
  Zed spawns from a desktop session. A terminal-launched Zed inherits it and a launcher-launched one
  does not, so this fails *intermittently* and presents as a silent "agent exited" with no cause.
- **Absolute path to the CLI too**, for the same reason. Without `--cli-path` the agent falls back
  to `resolveCliPath`, which wants `copilot` on `PATH`.
- **No `--workspace`.** `session/new` carries the project's cwd and the agent prefers it over
  anything passed at launch. Passing it would be a second source of truth for one fact.

Zed picks the file up without a restart.

## 4. Launch

```bash
cd /home/smolen/dev/vscode-copilot-cli-extension
ZED_ALLOW_EMULATED_GPU=1 zed .
```

**`ZED_ALLOW_EMULATED_GPU=1` is required under WSL.** Zed hard-stops on a software GPU, and WSLg
only ever exposes `llvmpipe`:

> Zed uses Vulkan for rendering and requires a compatible GPU. Currently you are using a software
> emulated GPU (llvmpipe) which will result in awful performance.

It renders slowly and works correctly. Put the variable in your shell profile if you launch Zed by
hand; it is set per-launch here so nothing is changed globally.

## 5. The UI path — what actually works

**There is no "new external agent thread" command**, whatever the docs imply. That was the first
wrong turn: `Ctrl+Shift+P` → `agent: new external agent thread` does not exist in 1.16.1.

What works:

1. Open the **Agent Panel** (right sidebar).
2. **New thread** — the `+` at the top of the panel.
3. If you land in *"Welcome to Zed AI"* asking you to sign in or add API keys, **you are in Zed's own
   agent, not ours.** Close it. That panel is for Zed's built-in agent and its model providers, which
   have nothing to do with us — **in ACP the agent brings its own model**, and ours is Copilot via
   the CLI. Nothing in Zed's *LLM Providers* affects it, and it cannot be pointed at a local model.
4. From the thread, pick **Copilot CLI Chat** from the agent selector.

Then: `Settings → AI → External Agents → Configure` is where Zed lists ACP agents, and is the
quickest way to confirm the config was read at all.

### Importing existing sessions

The thread sidebar offers **"Looking for threads from external agents? → Import Threads"**. That is
the only path that exercises `session/list`, and opening one of the imported threads is the only
path that exercises `session/load`.

On the first run it reported **740 threads** — matching our own `session/list` count exactly, after
the filter that hides plan-mode halves.

## 6. Verifying it actually worked

Zed logs agent **stderr** to its own log, so ours is readable there:

```bash
grep "agent_servers::acp" ~/.local/share/zed/logs/Zed.log | tail -30
```

A healthy start looks like:

```
[ACP] agent starting · workspace=/home/smolen/dev/vscode-copilot-cli-extension
[ACP] client connected; permission requests will be forwarded
[ACP] serving over NDJSON stream
[Permissions] request handler installed; deferring decisions to it
Using injected CLI path: …/copilot-linux-x64/copilot
CLI version with --no-auto-update: 1.0.68
```

**Which ACP methods Zed actually called:**

```bash
grep -oE "session/(new|load|prompt|cancel|close|list|fork|delete|set_mode)" \
  ~/.local/share/zed/logs/Zed.log | sort | uniq -c | sort -rn
```

On the first run that was `session/new` ×2, `session/list` ×1, `session/load` ×2 — and **never
`close`, `fork` or `delete`.** Those three are implemented and spike-verified and have still never
been exercised by a real host.

### Keep a durable copy — Zed's log rotates

`Zed.log` rotates, and it will rotate away the part you need. The first session worth diagnosing was
captured as a **35-second window**: everything before it, including `[ACP] agent starting`, was
already gone. The grep above tells you what Zed still has, not what happened.

Point the config at the wrapper instead of `node`:

```jsonc
{
  "agent_servers": {
    "Copilot CLI Chat": {
      "type": "custom",
      "command": "/home/smolen/dev/vscode-copilot-cli-extension/scripts/acp-agent-logged.sh",
      "args": ["--cli-path",
               "/home/smolen/dev/vscode-copilot-cli-extension/node_modules/@github/copilot-linux-x64/copilot"],
      "env": { "ACP_AGENT_NODE": "/home/smolen/.nvm/versions/node/v24.13.1/bin/node" }
    }
  }
}
```

It **tees** stderr: Zed still sees every line it saw before, and a full copy lands in
`~/.copilot/acp-agent-logs/agent-<timestamp>-<pid>.log`, one file per run, that nothing truncates.
Each file opens with the node binary, entry point, args and cwd — the four things you want first
when an agent dies without explaining itself.

```bash
ls -t ~/.copilot/acp-agent-logs/ | head          # runs, newest first
tail -f ~/.copilot/acp-agent-logs/$(ls -t ~/.copilot/acp-agent-logs | head -1)
```

**stdout is never touched.** It carries the protocol, and one stray byte on it desynchronises the
JSON-RPC framing — which is why the wrapper writes its own diagnostics to stderr and `exec`s rather
than wrapping in a subshell. Verified: with the wrapper in place, every line of stdout still parses
as JSON.

The wrapper also fails **loudly** on the two conditions that otherwise present as a bare
"agent exited": no usable `node` (say so, and name `ACP_AGENT_NODE`), and a missing
`out/acp/main.js` (say so, and name `compile-tests`).

Set `ACP_AGENT_LOG_DIR` to move the logs; `ACP_AGENT_ENTRY` to point at a different build.

**Saving one for the repo:** `tests/logs/zed/<version>-<symptom>.log`, matching the convention
`tests/logs/server/` already uses. That directory is gitignored, so those stay local to the machine
that captured them.

**Note the log level.** Zed labels *all* agent stderr as `WARN`, so every `[DEBUG]` line from us
reads as a warning. Not broken; noisy. Recorded as a polish item.

## 7. What the first run proved, and what it cost

Proved, against a client that has never seen our code: permissions round-tripped four times
including a session-scoped `approve-for-session`; file diffs rendered; `plan` entries drew Zed's
native *Plan · 3 Tasks* widget and updated live; the Work/Plan mode switcher appeared;
`session/list` returned 741 and `session/load` replayed 7 turns.

**Two defects it found that the suite could not:**

- `ModelCapabilitiesService` was never initialised whenever the client provider was **injected** —
  silently degrading model fallback, vision support and attachment validation for the whole agent
  process. Only a second consumer of the manager could surface it.
- `session/list` was offering plan-mode halves as conversations, 197 of 909. The fixtures had none,
  so the suite was green; two truncated ids in a debug line turned out to be a session and its plan.

## 8. Troubleshooting

| Symptom | Cause |
| --- | --- |
| Agent missing from the selector | `settings.json` unparsed. `Ctrl+Shift+P` → `zed: open settings` and check it is there. |
| "agent exited" with no output | Almost always a relative or absent `node` path. Use the absolute nvm path. |
| Zed refuses to start, complains about the GPU | `ZED_ALLOW_EMULATED_GPU=1`. |
| It asks you to sign in to Zed Pro | You are in Zed's own agent. Ours never asks — it authenticates through `~/.copilot`. |
| `out/acp/main.js` not found | `npm run compile-tests`, not `npm run compile`. |
| `Cannot find module '@agentclientprotocol/sdk'` | `npm install`. It is a declared dependency that a fresh checkout has not fetched. |
| Agent died and Zed showed nothing useful | Zed's log had already rotated. Use `scripts/acp-agent-logged.sh` — that is what it is for. |

## 9. What this configuration is not

It points at a **working checkout**. There is no installed artefact a user could configure, and
bundling one into the VSIX would not fix that — VS Code installs to `publisher.name-<version>/`, so
any path a user wrote into *their* editor would break on *our* next release. The route to a real
one is a separate npm package with a `bin`; the analysis is in
`planning/completed/v3.15.0-acp-release-declined.md` §3.1.
