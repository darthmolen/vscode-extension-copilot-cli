#!/usr/bin/env bash
# verify.sh — Shared verification script for CLI auto-update experiments
# Records binary metadata before and after CLI execution to detect mutation.
#
# Usage: source verify.sh
#        snapshot_binary "BEFORE" /path/to/copilot
#        ... run experiment ...
#        snapshot_binary "AFTER" /path/to/copilot
#        compare_snapshots

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

BEFORE_HASH=""
BEFORE_VERSION=""
BEFORE_SIZE=""
BEFORE_MTIME=""
AFTER_HASH=""
AFTER_VERSION=""
AFTER_SIZE=""
AFTER_MTIME=""

# Find the platform-specific bundled CLI binary in node_modules
find_bundled_cli() {
    local search_dir="${1:-.}"
    local arch
    case "$(uname -m)" in
        x86_64)  arch="linux-x64" ;;
        aarch64) arch="linux-arm64" ;;
        *)       echo "Unsupported arch: $(uname -m)" >&2; return 1 ;;
    esac
    local bin="$search_dir/node_modules/@github/copilot-${arch}/copilot"
    if [ -f "$bin" ]; then
        echo "$bin"
    else
        echo "Binary not found: $bin" >&2
        return 1
    fi
}

# Get the npm package.json version (what npm thinks is installed)
get_package_version() {
    local search_dir="${1:-.}"
    local arch
    case "$(uname -m)" in
        x86_64)  arch="linux-x64" ;;
        aarch64) arch="linux-arm64" ;;
        *)       echo "unknown" ; return ;;
    esac
    local pkg="$search_dir/node_modules/@github/copilot-${arch}/package.json"
    if [ -f "$pkg" ]; then
        node -e "console.log(JSON.parse(require('fs').readFileSync('$pkg','utf8')).version)"
    else
        echo "unknown"
    fi
}

# Snapshot binary metadata
snapshot_binary() {
    local label="$1"
    local binary="$2"

    if [ ! -f "$binary" ]; then
        echo -e "${RED}[$label] Binary not found: $binary${NC}"
        return 1
    fi

    local hash version size mtime
    hash=$(md5sum "$binary" | awk '{print $1}')
    version=$("$binary" --version 2>&1 || echo "FAILED")
    size=$(stat --format='%s' "$binary" 2>/dev/null || stat -f '%z' "$binary" 2>/dev/null)
    mtime=$(stat --format='%Y' "$binary" 2>/dev/null || stat -f '%m' "$binary" 2>/dev/null)

    echo -e "${CYAN}[$label]${NC}"
    echo "  md5:     $hash"
    echo "  version: $version"
    echo "  size:    $size bytes"
    echo "  mtime:   $mtime"

    if [ "$label" = "BEFORE" ]; then
        BEFORE_HASH="$hash"
        BEFORE_VERSION="$version"
        BEFORE_SIZE="$size"
        BEFORE_MTIME="$mtime"
    else
        AFTER_HASH="$hash"
        AFTER_VERSION="$version"
        AFTER_SIZE="$size"
        AFTER_MTIME="$mtime"
    fi
}

# Compare before/after snapshots
compare_snapshots() {
    echo ""
    if [ "$BEFORE_HASH" = "$AFTER_HASH" ]; then
        echo -e "${GREEN}RESULT: Binary DID NOT change (hash match)${NC}"
        echo "  Auto-update: NOT triggered"
    else
        echo -e "${RED}RESULT: Binary CHANGED (auto-update detected!)${NC}"
        echo "  Before: $BEFORE_VERSION ($BEFORE_HASH, $BEFORE_SIZE bytes)"
        echo "  After:  $AFTER_VERSION ($AFTER_HASH, $AFTER_SIZE bytes)"
        echo "  mtime:  $BEFORE_MTIME → $AFTER_MTIME"
    fi
    echo ""
}

# Test --headless --stdio support by sending a JSON-RPC initialize and checking response
test_headless() {
    local binary="$1"
    local label="${2:-headless}"
    echo -e "${CYAN}[TEST] $label: --headless --stdio${NC}"

    local init_msg='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2.0","capabilities":{},"clientInfo":{"name":"spike","version":"1.0"}}}'

    local output
    output=$(echo "$init_msg" | timeout 10 "$binary" --headless --stdio 2>&1 || true)

    if echo "$output" | grep -q '"result"'; then
        echo -e "  ${GREEN}SUPPORTED — got JSON-RPC result${NC}"
        return 0
    elif echo "$output" | grep -qi 'unknown flag\|unknown option\|not recognized'; then
        echo -e "  ${RED}NOT SUPPORTED — flag rejected${NC}"
        echo "  Output: $(echo "$output" | head -3)"
        return 1
    else
        echo -e "  ${YELLOW}UNCLEAR — check output:${NC}"
        echo "  $(echo "$output" | head -5)"
        return 2
    fi
}

# Test --acp --stdio support
test_acp() {
    local binary="$1"
    local label="${2:-acp}"
    echo -e "${CYAN}[TEST] $label: --acp --stdio${NC}"

    local init_msg='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2.0","capabilities":{},"clientInfo":{"name":"spike","version":"1.0"}}}'

    local output
    output=$(echo "$init_msg" | timeout 10 "$binary" --acp --stdio 2>&1 || true)

    if echo "$output" | grep -q '"result"'; then
        echo -e "  ${GREEN}SUPPORTED — got JSON-RPC result${NC}"
        return 0
    elif echo "$output" | grep -qi 'unknown flag\|unknown option\|not recognized'; then
        echo -e "  ${RED}NOT SUPPORTED — flag rejected${NC}"
        echo "  Output: $(echo "$output" | head -3)"
        return 1
    else
        echo -e "  ${YELLOW}UNCLEAR — check output:${NC}"
        echo "  $(echo "$output" | head -5)"
        return 2
    fi
}

echo -e "${GREEN}verify.sh loaded${NC}"
