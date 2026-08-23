#!/usr/bin/env bash
#
# Launch the ACP agent for an external host, keeping a durable copy of its stderr.
#
# Why this exists: a host spawns the agent and captures its stderr into the host's
# own log, which rotates. The first session that mattered was diagnosed from a
# 35-second window because everything before it — including `[ACP] agent starting`
# — had already been rotated away.
#
# So stderr is TEE'd: the host still sees every line it saw before, and a full copy
# lands in a file per run that nothing else truncates.
#
# stdout is never touched. It is the protocol, and a single stray byte on it
# desynchronises the JSON-RPC framing.
#
# Point a host's agent config at this instead of `node`:
#
#   "command": "/abs/path/scripts/acp-agent-logged.sh"
#   "args":    ["--cli-path", "/abs/path/node_modules/@github/copilot-linux-x64/copilot"]
#
# Env:
#   ACP_AGENT_NODE     absolute node binary   (default: `command -v node`)
#   ACP_AGENT_ENTRY    absolute main.js       (default: ../out/acp/main.js)
#   ACP_AGENT_LOG_DIR  where logs land        (default: ~/.copilot/acp-agent-logs)

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${ACP_AGENT_NODE:-$(command -v node || true)}"
ENTRY="${ACP_AGENT_ENTRY:-$REPO_ROOT/out/acp/main.js}"
LOG_DIR="${ACP_AGENT_LOG_DIR:-$HOME/.copilot/acp-agent-logs}"

# Fail loudly on stderr rather than dying silently. A host renders a dead agent as
# "agent exited" with no cause, which is the single most expensive failure here.
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
    echo "[acp-agent-logged] no usable node. Set ACP_AGENT_NODE to an absolute path." >&2
    echo "[acp-agent-logged] nvm-managed node is NOT on PATH for a GUI-spawned process." >&2
    exit 127
fi
if [ ! -f "$ENTRY" ]; then
    echo "[acp-agent-logged] missing $ENTRY — run 'npm run compile-tests' (not 'npm run compile')." >&2
    exit 127
fi

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/agent-$(date +%Y%m%d-%H%M%S)-$$.log"

{
    echo "=== acp agent starting $(date -Is) ==="
    echo "    node   : $NODE_BIN"
    echo "    entry  : $ENTRY"
    echo "    args   : $*"
    echo "    cwd    : $(pwd)"
} >> "$LOG_FILE"

# `exec` so signals reach node directly rather than this wrapper. Process
# substitution keeps the host's view of stderr intact while the copy accumulates.
exec "$NODE_BIN" "$ENTRY" "$@" 2> >(tee -a "$LOG_FILE" >&2)
