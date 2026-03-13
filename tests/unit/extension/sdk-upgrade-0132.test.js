/**
 * Tests for SDK 0.1.32 upgrade (v3.5.0)
 *
 * TDD RED phase: Tests written BEFORE the implementation exists.
 *
 * Covers:
 * 1. New SDK event types handled explicitly (not falling to default)
 *    - subagent.deselected
 *    - session.task_complete
 *    - session.background_tasks_changed
 *    - system.notification
 *    - permission.requested
 *    - permission.completed
 * 2. onEvent race fix — injected into createSessionWithModelFallback config
 * 3. _handleSDKEvent at runtime does NOT log "Unhandled event type" for new events
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SOURCE_PATH = path.join(__dirname, '../../../src/sdkSessionManager.ts');

describe('SDK 0.1.32 Upgrade', function () {
    this.timeout(10000);

    let source;

    before(function () {
        source = fs.readFileSync(SOURCE_PATH, 'utf8');
    });

    // -----------------------------------------------------------------------
    // Phase 1: New event type cases
    // -----------------------------------------------------------------------

    describe('New SDK event handlers — source code', function () {
        const NEW_EVENTS = [
            'subagent.deselected',
            'session.task_complete',
            'session.background_tasks_changed',
            'system.notification',
            'permission.requested',
            'permission.completed',
        ];

        for (const eventType of NEW_EVENTS) {
            it(`should have an explicit case for '${eventType}' in _handleSDKEvent`, function () {
                assert.ok(
                    source.includes(`case '${eventType}'`),
                    `Expected case '${eventType}' to be present in _handleSDKEvent`
                );
            });
        }

        it('should NOT have any of the new events fall to the default branch', function () {
            // Extract the _handleSDKEvent method body
            const methodStart = source.indexOf('private _handleSDKEvent(');
            assert.ok(methodStart !== -1, '_handleSDKEvent method must exist');

            // Find the switch block inside the method
            const switchStart = source.indexOf('switch (event.type)', methodStart);
            assert.ok(switchStart !== -1, 'switch(event.type) must exist in _handleSDKEvent');

            // Find the default: case
            const defaultStart = source.indexOf('\n            default:', switchStart);
            assert.ok(defaultStart !== -1, 'default: case must exist in the switch');

            // Verify every new event case appears before the default:
            for (const eventType of NEW_EVENTS) {
                const casePos = source.indexOf(`case '${eventType}'`, switchStart);
                assert.ok(
                    casePos !== -1 && casePos < defaultStart,
                    `case '${eventType}' must appear before default: in the switch`
                );
            }
        });
    });

    // -----------------------------------------------------------------------
    // Phase 1: Runtime — _handleSDKEvent does not log "Unhandled event type"
    // -----------------------------------------------------------------------

    describe('New SDK event handlers — runtime', function () {
        let SDKSessionManager;

        before(function () {
            try {
                const mod = require('../../../out/sdkSessionManager.js');
                SDKSessionManager = mod.SDKSessionManager;
            } catch (e) {
                console.log('Module not yet compiled, skipping:', e.message);
                this.skip();
            }
        });

        function makeManager(debugMessages) {
            const context = Object.create(SDKSessionManager.prototype);
            context.logger = {
                info: () => {},
                warn: () => {},
                error: () => {},
                debug: (msg) => { debugMessages.push(msg); },
            };
            context._onDidTaskComplete = { fire: () => {} };
            return context;
        }

        const testCases = [
            { type: 'subagent.deselected', data: { subagentId: 'agent-1' } },
            { type: 'session.background_tasks_changed', data: { count: 2 } },
            { type: 'system.notification', data: { kind: { description: 'test notification' } } },
            { type: 'permission.requested', data: { permission: 'read' } },
            { type: 'permission.completed', data: { permission: 'read', granted: true } },
            { type: 'session.task_complete', data: { summary: 'Task done' } },
        ];

        for (const { type, data } of testCases) {
            it(`'${type}' should NOT produce "Unhandled event type" debug log`, function () {
                const debugMessages = [];
                const manager = makeManager(debugMessages);

                manager._handleSDKEvent({ type, data });

                const unhandled = debugMessages.filter(m => m.includes('Unhandled event type'));
                assert.strictEqual(
                    unhandled.length,
                    0,
                    `Event '${type}' fell through to default: got debug messages: ${JSON.stringify(debugMessages)}`
                );
            });
        }
    });

    // -----------------------------------------------------------------------
    // Phase 2: onEvent race condition fix
    // -----------------------------------------------------------------------

    describe('onEvent race condition fix', function () {
        it('should inject onEvent handler into createSessionWithModelFallback config', function () {
            // Verify the source contains onEvent injection in createSessionWithModelFallback
            const methodMatch = source.match(
                /private async createSessionWithModelFallback\([\s\S]*?\{([\s\S]*?)(?=private\s|public\s)/
            );
            assert.ok(methodMatch, 'createSessionWithModelFallback method must exist');

            const methodBody = methodMatch[1];
            assert.ok(
                methodBody.includes('onEvent'),
                'createSessionWithModelFallback should inject onEvent into config'
            );
            assert.ok(
                methodBody.includes('_handleSDKEvent'),
                'onEvent handler should delegate to _handleSDKEvent'
            );
        });
    });
});
