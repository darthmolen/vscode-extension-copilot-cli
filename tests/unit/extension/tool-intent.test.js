/**
 * Per-tool-call intent, the successor to `report_intent`.
 *
 * The tool line used to be labelled from a `report_intent` tool the model called.
 * CLI 1.0.80 does not have that tool — it answers `Unknown tool name in the tool
 * allowlist` — so the label went bare.
 *
 * The CLI supplies it directly now: every entry in `assistant.message.toolRequests`
 * carries `intentionSummary`, *"resolved intention summary describing what this
 * specific call does"*, alongside the `toolCallId` that `tool.execution_start`
 * reports. So the intent is keyed to the call it belongs to.
 *
 * That fixes a real defect in the old approach, which the code admitted to:
 *
 *     // Clear intent after first use to prevent it sticking to all subsequent tools
 *
 * One `lastMessageIntent` held the most recent intent for whichever tool started
 * next. A message requesting three tools gave the first one its label and the other
 * two nothing — and any mismatch silently mislabelled a tool. Keying by
 * `toolCallId` removes the guess.
 */

const assert = require('assert');
const path = require('path');
const { installVscodeMock } = require('../../helpers/with-vscode-mock');

describe('collectToolIntents', function () {
    // Scoped, not module-scope: patching `Module.prototype.require` and leaving it
    // is one of the documented globals that leak across files in this suite, and
    // the reason a green run proves so little. The helper puts back exactly what it
    // found and evicts what loaded under the mock.
    const mock = installVscodeMock();
    let collectToolIntents;

    before(function () {
        mock.install();
        const mod = require(path.join(__dirname, '../../..', 'out', 'sdkSessionManager.js'));
        collectToolIntents = mod.collectToolIntents;
    });

    after(function () {
        mock.restore();
    });

    it('keys each intention summary by its tool call id', function () {
        const intents = collectToolIntents([
            { toolCallId: 'a', name: 'view', intentionSummary: 'Reading the resume path' },
            { toolCallId: 'b', name: 'grep', intentionSummary: 'Finding the pairing module' }
        ]);

        assert.strictEqual(intents.get('a'), 'Reading the resume path');
        assert.strictEqual(intents.get('b'), 'Finding the pairing module');
    });

    it('labels every tool in a multi-tool message, not just the first', function () {
        // The defect in the old single-slot approach.
        const intents = collectToolIntents([
            { toolCallId: 'a', intentionSummary: 'first' },
            { toolCallId: 'b', intentionSummary: 'second' },
            { toolCallId: 'c', intentionSummary: 'third' }
        ]);

        assert.strictEqual(intents.size, 3);
    });

    it('skips a request with no intention summary rather than inventing one', function () {
        const intents = collectToolIntents([
            { toolCallId: 'a', name: 'view' },
            { toolCallId: 'b', name: 'grep', intentionSummary: null },
            { toolCallId: 'c', name: 'glob', intentionSummary: '' },
            { toolCallId: 'd', name: 'bash', intentionSummary: '   ' }
        ]);

        assert.strictEqual(intents.size, 0);
    });

    it('skips a request with no tool call id', function () {
        const intents = collectToolIntents([
            { name: 'view', intentionSummary: 'orphaned' }
        ]);

        assert.strictEqual(intents.size, 0);
    });

    it('returns an empty map for anything that is not an array', function () {
        // `toolRequests` is optional on the event, and older CLIs omit it.
        for (const input of [undefined, null, 'nope', 42, {}]) {
            const intents = collectToolIntents(input);
            assert.strictEqual(intents.size, 0, `expected empty map for ${JSON.stringify(input)}`);
        }
    });

    it('ignores a non-string summary', function () {
        const intents = collectToolIntents([
            { toolCallId: 'a', intentionSummary: { text: 'nope' } },
            { toolCallId: 'b', intentionSummary: 7 }
        ]);

        assert.strictEqual(intents.size, 0);
    });
});
