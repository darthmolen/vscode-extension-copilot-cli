#!/usr/bin/env bash
# run-all.sh — Orchestrate all CLI auto-update experiments
#
# Runs experiments in order of complexity:
#   4  → Version sweep (cheapest, no SDK)
#   1  → SDK v0.1.22 auto-update proof
#   2b → SDK v0.1.22 + manual --no-auto-update
#   2  → SDK v0.1.25 with built-in fix
#   3  → Dual CLI environment
#
# Usage: ./run-all.sh
# Or to run a single experiment: ./experiment-4.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESULTS_FILE="${SCRIPT_DIR}/results.txt"

echo "=============================================" | tee "$RESULTS_FILE"
echo " CLI Auto-Update Spike — $(date -u '+%Y-%m-%d %H:%M:%S UTC')" | tee -a "$RESULTS_FILE"
echo " Node: $(node --version)" | tee -a "$RESULTS_FILE"
echo " npm:  $(npm --version)" | tee -a "$RESULTS_FILE"
echo " Arch: $(uname -m)" | tee -a "$RESULTS_FILE"
echo " Auth: ${GITHUB_TOKEN:+present}${GITHUB_TOKEN:-MISSING}" | tee -a "$RESULTS_FILE"
echo "=============================================" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

run_experiment() {
    local name="$1"
    local script="$2"

    echo "" | tee -a "$RESULTS_FILE"
    echo ">>>>> $name <<<<<" | tee -a "$RESULTS_FILE"
    echo "" | tee -a "$RESULTS_FILE"

    if [ "${script##*.}" = "sh" ]; then
        bash "$SCRIPT_DIR/$script" 2>&1 | tee -a "$RESULTS_FILE"
    else
        node "$SCRIPT_DIR/$script" 2>&1 | tee -a "$RESULTS_FILE"
    fi

    local exit_code=${PIPESTATUS[0]}
    if [ $exit_code -ne 0 ]; then
        echo "[WARN] $name exited with code $exit_code" | tee -a "$RESULTS_FILE"
    fi
    echo "" | tee -a "$RESULTS_FILE"
}

# Run in order of value/complexity
run_experiment "Exp 4: CLI Version Sweep" "experiment-4.sh"
run_experiment "Exp 1: SDK v0.1.22 Auto-Update" "experiment-1.mjs"
run_experiment "Exp 2b: Manual --no-auto-update" "experiment-2b.mjs"
run_experiment "Exp 2: SDK v0.1.25 Fix" "experiment-2.mjs"
run_experiment "Exp 3: Dual CLI" "experiment-3.mjs"

echo "" | tee -a "$RESULTS_FILE"
echo "=============================================" | tee -a "$RESULTS_FILE"
echo " ALL EXPERIMENTS COMPLETE" | tee -a "$RESULTS_FILE"
echo " Results saved to: $RESULTS_FILE" | tee -a "$RESULTS_FILE"
echo "=============================================" | tee -a "$RESULTS_FILE"
