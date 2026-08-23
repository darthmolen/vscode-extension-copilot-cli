# OUT-2 — Agents window cannot connect to a localhost Agent Host

**Venue:** `microsoft/vscode` — new issue (feature request)
**Category:** b · **Confidence:** Medium · **Status:** drafted, unsent
**Blocking?** No — IN-9 (our own host) routes around it, at cost.

## Why this is the strongest outbound ask

It is the one item that is **narrow, concrete, independently verifiable, and
competes with nobody's design proposal**. It does not require anyone to accept
an architecture; it closes an asymmetry that already exists in their own
shipped behaviour. That also makes it the hardest to close as a duplicate of
[#325827](https://github.com/microsoft/vscode/issues/325827).

## The asymmetry

- `code agent host` already serves AHP over WebSocket on localhost, protected
  by a connection token — documented.
- [#311105](https://github.com/microsoft/vscode/issues/311105) (closed, milestone 1.117.0) treats **"VS Code + local agent host"** as a supported, test-planned configuration.
- But the Agents window workspace picker offers only **Tunnels** and **SSH**.

So VS Code can talk to a local Agent Host it started itself, and to a remote one
over a tunnel — but there is no way to point it at a host on `127.0.0.1` that it
did not launch.

## Draft

```markdown
### Summary

`code agent host` starts a standalone Agent Host on localhost protected by a
connection token, and #311105 covers "VS Code + local agent host" as a supported
configuration. But the Agents window's workspace picker only offers **Tunnels**
and **SSH** as connection entry points, so there is no way to attach to an
already-running Agent Host on 127.0.0.1.

### Why it matters

The remote agent host path already supports dynamic agent discovery from
`rootState.agents`. A localhost connection entry point would bring the same
capability to local development without any new API surface — the transport,
the token handshake, and the discovery mechanism all already exist and ship.

Today the workaround is to expose a local process through a dev tunnel, which
means round-tripping localhost traffic through a relay purely to satisfy the
picker.

### Proposal

Add a third entry point alongside Tunnels and SSH that accepts a host address
and connection token (e.g. `ws://127.0.0.1:<port>` + token), or a setting that
registers one.

### Environment

VS Code 1.133, `chat.agentHost.enabled: true`.
```

## Notes for the sender

- Frame as an asymmetry in existing behaviour, not as a new capability.
- Cite #311105 — it is their own evidence that the local configuration is real.
- Do **not** mention third-party agents here; that is OUT-3's subject and mixing
  them invites a duplicate-close.
