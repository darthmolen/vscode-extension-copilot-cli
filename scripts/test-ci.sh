#!/usr/bin/env bash
#
# CI unit-test runner: runs each tests/unit subdirectory as its OWN mocha process.
#
# Why: the webview component tests create JSDOM windows/globals; running all ~135 files in
# one process lets that leakage accumulate until the event loop congests and unrelated
# async tests/hooks time out (a different one each run). Splitting by directory keeps each
# process smaller so accumulation is bounded.
#
# Why WHOLE directories (not smaller batches): the suite has implicit cross-file setup
# dependencies — files rely on globals/mocks their siblings install. Splitting below the
# directory level (arbitrary batches, or sub-batches within a dir) drops those deps and
# deterministically mass-fails. Whole-directory groups are the finest dep-safe split.
#
# A generous per-process timeout + `--retries` lets a test survive a transient congestion
# spike in the heavier groups.
#
# Local devs can keep using `npm run test:unit` (single fast process, strict).

set -uo pipefail
# `**` is only recursive with globstar; nullglob makes an unmatched glob expand to nothing
# rather than a literal pattern. Both keep the compgen guards and file discovery correct on
# any bash (e.g. CI ubuntu) regardless of the caller's shell options.
shopt -s globstar nullglob

TIMEOUT="${MOCHA_TIMEOUT:-45000}"
RETRIES="${MOCHA_RETRIES:-2}"

fail=0
for dir in tests/unit/*/; do
  [ -d "$dir" ] || continue
  if ! compgen -G "$dir/**/*.test.js" > /dev/null && ! compgen -G "$dir/*.test.js" > /dev/null; then
    continue
  fi
  echo "::group::mocha $dir"
  npx mocha "$dir/**/*.test.js" --recursive --timeout "$TIMEOUT" --retries "$RETRIES" || fail=1
  echo "::endgroup::"
done

# Safety net: any top-level tests/unit/*.test.js not inside a subdirectory.
if compgen -G "tests/unit/*.test.js" > /dev/null; then
  echo "::group::mocha tests/unit (top-level)"
  npx mocha "tests/unit/*.test.js" --timeout "$TIMEOUT" --retries "$RETRIES" || fail=1
  echo "::endgroup::"
fi

if [ "$fail" -ne 0 ]; then
  echo "❌ one or more unit-test groups failed"
else
  echo "✅ all unit-test groups passed"
fi
exit "$fail"
