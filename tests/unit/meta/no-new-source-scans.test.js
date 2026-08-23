/**
 * The gate that the rule never was.
 *
 * `CLAUDE.md` has long prohibited tests that read a production file and assert its
 * *text* contains a string. They kept being written anyway — by AI, in sessions
 * with that file loaded — because prose is not a gate. Nothing in the loop ever
 * failed because of it: every removal so far came from a refactor breaking them, or
 * from someone spending an afternoon hunting them.
 *
 * The arithmetic explains the persistence. A source scan passes on its first run
 * and never flakes, so it reads as a cheap green test, while a behavioural test
 * costs more to write and can fail. Under pressure to move, the cheap one wins.
 *
 * So this is a ratchet, not a sweep. `KNOWN_SOURCE_READERS` is the debt as it stood
 * on 2026-08-22. The gate fails two ways:
 *
 *   - a file **not** on the list reads `src/` — the pile is regrowing;
 *   - a file **on** the list no longer reads `src/` — clean it up, take it off.
 *
 * The second direction is the point. It stops the list going stale, and it means
 * the only way through this test is down.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

const TESTS_ROOT = path.join(__dirname, '..', '..');

/**
 * Test files that still read something under `src/`.
 *
 * Burn this down. Each entry is a debt, not an exemption — see
 * `planning/backlog/source-scan-tests.md` for how to retire one.
 */
const KNOWN_SOURCE_READERS = [
    'e2e/session/session-timeout.test.js',
    'integration/plan-mode/plan-file-exists-check.test.js',
    // Reads `src/webview/styles.css` for two responsive breakpoints. Kept: JSDOM
    // does not apply stylesheets, so there is no way to run the assertion here, and
    // a silently-dropped media query is a real regression. Its `src/*.ts` scans are gone.
    'integration/sidebar/sidebar-view-migration.test.js',
    'integration/webview/streaming-rpc-flow.test.js',
    'unit/components/MessageDisplay-inactivity-flush.test.js',
    'unit/components/message-display-url-overflow.test.js',
    'unit/components/session-dropdown-real-tdd.test.js',
    'unit/components/thinking-animation.test.js',
    'unit/extension/plan-mode-duplicate-tools.test.js',
    'unit/extension/plan-mode-session-name.test.js',
    'unit/extension/sdk-title-changed-strip-prefix.test.js',
    'unit/extension/sdk-upgrade-0126.test.js',
    'unit/extension/sdk-upgrade-0132.test.js',
    'unit/extension/suppress-broken-sentence-bubble.test.js'
];

/** Every test file under tests/, as a path relative to tests/. This file excluded —
 *  it necessarily names `src/` in order to look for it. */
function allTestFiles(dir = TESTS_ROOT, found = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'logs') { continue; }
            allTestFiles(full, found);
        } else if (/\.test\.(js|mjs)$/.test(entry.name) && entry.name !== path.basename(__filename)) {
            found.push(path.relative(TESTS_ROOT, full).split(path.sep).join('/'));
        }
    }
    return found;
}

/**
 * Whether a test file reads a production file.
 *
 * Deliberately crude: it looks for a `src/…` path literal alongside a filesystem
 * read. A test that needs production *behaviour* imports the module — from `out/`
 * for TypeScript, or directly for the webview's ES modules — and never has to open
 * it as text.
 */
function readsProductionSource(relativePath) {
    const source = withoutComments(fs.readFileSync(path.join(TESTS_ROOT, relativePath), 'utf-8'));
    const opensFiles = /readFileSync|readFile\s*\(/.test(source);
    const namesSrc = /['"`][^'"`]*\bsrc\/|['"`]src['"`]/.test(source);
    return opensFiles && namesSrc;
}

/**
 * Comments stripped before matching — because the first version of this gate fell
 * into the trap it exists to catch. It flagged `file-snapshot-hooks.test.js`, which
 * reads only temp files and mentions `src/` in a comment describing what it mirrors.
 * A string match that cannot tell code from prose is the whole defect.
 */
function withoutComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

describe('No new source-scan tests', () => {
    const offenders = allTestFiles().filter(readsProductionSource);

    it('adds no test that reads production files as text', () => {
        const unexpected = offenders.filter(f => !KNOWN_SOURCE_READERS.includes(f));

        expect(unexpected, [
            'These test files read something under src/ and assert on it.',
            'A test that needs production behaviour imports the module and runs it.',
            'If you genuinely cannot, say so in a comment and add the file to',
            'KNOWN_SOURCE_READERS with a reason — but read',
            'planning/backlog/source-scan-tests.md first.'
        ].join(' ')).to.deep.equal([]);
    });

    it('keeps the known list honest — clean a file, take it off the list', () => {
        const cleaned = KNOWN_SOURCE_READERS.filter(f => !offenders.includes(f));

        expect(cleaned, [
            'These files are on KNOWN_SOURCE_READERS but no longer read src/.',
            'Remove them from the list: the only way through this gate is down.'
        ].join(' ')).to.deep.equal([]);
    });
});
