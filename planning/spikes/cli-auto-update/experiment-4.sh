#!/usr/bin/env bash
# Experiment 4: CLI Version Sweep
#
# Tests which CLI versions support --headless --stdio vs --acp --stdio.
# Installs each version in isolation and probes flag support.
#
# Output: version matrix table

set -euo pipefail
source "$(dirname "$0")/verify.sh"

VERSIONS=(0.0.403 0.0.409 0.0.410 0.0.411 0.0.414)

echo "============================================="
echo " EXPERIMENT 4: CLI Version Sweep"
echo "============================================="
echo ""

# Results table header
printf "%-12s %-10s %-10s %-15s %-15s\n" "VERSION" "INSTALLED" "--headless" "--acp" "BINARY SIZE"
printf "%-12s %-10s %-10s %-15s %-15s\n" "-------" "---------" "----------" "-----" "-----------"

for ver in "${VERSIONS[@]}"; do
    echo ""
    echo -e "${CYAN}--- Testing CLI v${ver} ---${NC}"

    # Create isolated workspace
    workdir=$(mktemp -d)
    cd "$workdir"
    npm init -y --silent 2>/dev/null

    # Install this specific CLI version
    if ! npm install "@github/copilot@${ver}" --silent 2>/dev/null; then
        printf "%-12s %-10s %-10s %-15s %-15s\n" "$ver" "FAILED" "-" "-" "-"
        rm -rf "$workdir"
        continue
    fi

    # Find the binary
    binary=$(find_bundled_cli "$workdir") || {
        printf "%-12s %-10s %-10s %-15s %-15s\n" "$ver" "NO_BINARY" "-" "-" "-"
        rm -rf "$workdir"
        continue
    }

    # Record hash BEFORE any execution
    pre_hash=$(md5sum "$binary" | awk '{print $1}')

    # Get version WITH --no-auto-update to prevent mutation
    actual_ver=$("$binary" --version --no-auto-update 2>&1 | grep -oP '[\d.]+' | head -1 || echo "unknown")
    size=$(stat --format='%s' "$binary" 2>/dev/null || echo "unknown")

    # Check if --version itself mutated the binary (even with --no-auto-update)
    post_ver_hash=$(md5sum "$binary" | awk '{print $1}')
    if [ "$pre_hash" != "$post_ver_hash" ]; then
        echo "  WARNING: --version --no-auto-update STILL mutated the binary!"
        echo "  Before: $pre_hash  After: $post_ver_hash"
    fi

    # Test --headless --stdio (with --no-auto-update to prevent mutation during test)
    headless_result="UNKNOWN"
    # ACP expects protocolVersion as number, headless uses string
    headless_init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2.0","capabilities":{},"clientInfo":{"name":"spike","version":"1.0"}}}'
    acp_init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":2,"capabilities":{},"clientInfo":{"name":"spike","version":"1.0"}}}'

    headless_output=$(echo "$headless_init" | timeout 15 "$binary" --headless --stdio --no-auto-update 2>&1 || true)
    if echo "$headless_output" | grep -q '"result"'; then
        headless_result="YES"
    elif echo "$headless_output" | grep -qi 'unknown flag\|unknown option\|not recognized\|Error:'; then
        headless_result="NO"
    elif echo "$headless_output" | grep -q '"error"'; then
        headless_result="PARTIAL"
    else
        headless_result="TIMEOUT"
    fi

    # Test --acp --stdio
    acp_result="UNKNOWN"
    acp_output=$(echo "$acp_init" | timeout 15 "$binary" --acp --stdio --no-auto-update 2>&1 || true)
    if echo "$acp_output" | grep -q '"result"'; then
        acp_result="YES"
    elif echo "$acp_output" | grep -qi 'unknown flag\|unknown option\|not recognized\|Error:'; then
        acp_result="NO"
    elif echo "$acp_output" | grep -q '"error"'; then
        acp_result="PARTIAL"
    else
        acp_result="TIMEOUT"
    fi

    printf "%-12s %-10s %-10s %-15s %-15s\n" "$ver" "$actual_ver" "$headless_result" "$acp_result" "$size"

    # Verbose output for debugging
    if [ "$headless_result" != "YES" ]; then
        echo "  --headless output: $(echo "$headless_output" | head -2)"
    fi
    if [ "$acp_result" != "YES" ]; then
        echo "  --acp output: $(echo "$acp_output" | head -2)"
    fi

    # Cleanup
    rm -rf "$workdir"
done

echo ""
echo "============================================="
echo " EXPERIMENT 4: COMPLETE"
echo "============================================="
