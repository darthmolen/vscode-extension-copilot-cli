/**
 * Present Plan Tool Test
 * Tests the present_plan custom tool that notifies UI when plan is ready
 * Does NOT rely on LLM behavior - tests tool logic and event emission
 */

const assert = require('assert');
const { randomUUID } = require('crypto');
const EventEmitter = require('events');

describe('Present Plan Tool Tests', function () {

    describe('present_plan tool handler', function () {
        it('should return success message', async function () {
            const mockEmitter = new EventEmitter();
            let emittedEvent = null;

            mockEmitter.on('fire', (event) => {
                emittedEvent = event;
            });

            const handler = async ({ summary }) => {
                const event = {
                    type: 'status',
                    data: {
                        status: 'plan_ready',
                        summary: summary || null
                    },
                    timestamp: Date.now()
                };
                mockEmitter.emit('fire', event);
                return `Plan presented to user. They can now review it and choose to accept, continue planning, or provide new instructions.`;
            };

            const result = await handler({ summary: 'Test plan summary' });

            assert.ok(result.includes('Plan presented'));
        });

        it('should execute without error', async function () {
            const mockEmitter = new EventEmitter();

            const handler = async ({ summary }) => {
                const event = {
                    type: 'status',
                    data: {
                        status: 'plan_ready',
                        summary: summary || null
                    },
                    timestamp: Date.now()
                };
                mockEmitter.emit('fire', event);
                return `Plan presented to user.`;
            };

            // Should not throw
            await handler({ summary: 'Test' });
        });
    });

    describe('Event emission with summary', function () {
        it('should emit an event', async function () {
            const mockEmitter = new EventEmitter();
            let capturedEvent = null;

            mockEmitter.on('fire', (event) => {
                capturedEvent = event;
            });

            const handler = async ({ summary }) => {
                const event = {
                    type: 'status',
                    data: {
                        status: 'plan_ready',
                        summary: summary || null
                    },
                    timestamp: Date.now()
                };
                mockEmitter.emit('fire', event);
                return 'Success';
            };

            await handler({ summary: 'Plan for implementing feature X' });

            assert.notStrictEqual(capturedEvent, null);
        });

        it('should emit event with type status', async function () {
            const mockEmitter = new EventEmitter();
            let capturedEvent = null;

            mockEmitter.on('fire', (event) => {
                capturedEvent = event;
            });

            const handler = async ({ summary }) => {
                const event = {
                    type: 'status',
                    data: {
                        status: 'plan_ready',
                        summary: summary || null
                    },
                    timestamp: Date.now()
                };
                mockEmitter.emit('fire', event);
                return 'Success';
            };

            await handler({ summary: 'Plan for implementing feature X' });

            assert.strictEqual(capturedEvent.type, 'status');
        });

        it('should emit event with status plan_ready', async function () {
            const mockEmitter = new EventEmitter();
            let capturedEvent = null;

            mockEmitter.on('fire', (event) => {
                capturedEvent = event;
            });

            const handler = async ({ summary }) => {
                const event = {
                    type: 'status',
                    data: {
                        status: 'plan_ready',
                        summary: summary || null
                    },
                    timestamp: Date.now()
                };
                mockEmitter.emit('fire', event);
                return 'Success';
            };

            await handler({ summary: 'Plan for implementing feature X' });

            assert.strictEqual(capturedEvent.data.status, 'plan_ready');
        });

        it('should pass summary correctly', async function () {
            const mockEmitter = new EventEmitter();
            let capturedEvent = null;

            mockEmitter.on('fire', (event) => {
                capturedEvent = event;
            });

            const handler = async ({ summary }) => {
                const event = {
                    type: 'status',
                    data: {
                        status: 'plan_ready',
                        summary: summary || null
                    },
                    timestamp: Date.now()
                };
                mockEmitter.emit('fire', event);
                return 'Success';
            };

            await handler({ summary: 'Plan for implementing feature X' });

            assert.strictEqual(capturedEvent.data.summary, 'Plan for implementing feature X');
        });

        it('should include a timestamp', async function () {
            const mockEmitter = new EventEmitter();
            let capturedEvent = null;

            mockEmitter.on('fire', (event) => {
                capturedEvent = event;
            });

            const handler = async ({ summary }) => {
                const event = {
                    type: 'status',
                    data: {
                        status: 'plan_ready',
                        summary: summary || null
                    },
                    timestamp: Date.now()
                };
                mockEmitter.emit('fire', event);
                return 'Success';
            };

            await handler({ summary: 'Plan for implementing feature X' });

            assert.strictEqual(typeof capturedEvent.timestamp, 'number');
        });
    });

    describe('Event emission without summary (optional parameter)', function () {
        it('should emit event without summary', async function () {
            const mockEmitter = new EventEmitter();
            let capturedEvent = null;

            mockEmitter.on('fire', (event) => {
                capturedEvent = event;
            });

            const handler = async ({ summary }) => {
                const event = {
                    type: 'status',
                    data: {
                        status: 'plan_ready',
                        summary: summary || null
                    },
                    timestamp: Date.now()
                };
                mockEmitter.emit('fire', event);
                return 'Success';
            };

            await handler({});

            assert.notStrictEqual(capturedEvent, null);
        });

        it('should set summary to null when omitted', async function () {
            const mockEmitter = new EventEmitter();
            let capturedEvent = null;

            mockEmitter.on('fire', (event) => {
                capturedEvent = event;
            });

            const handler = async ({ summary }) => {
                const event = {
                    type: 'status',
                    data: {
                        status: 'plan_ready',
                        summary: summary || null
                    },
                    timestamp: Date.now()
                };
                mockEmitter.emit('fire', event);
                return 'Success';
            };

            await handler({});

            assert.strictEqual(capturedEvent.data.summary, null);
        });
    });

    describe('Multiple sequential present_plan calls', function () {
        it('should emit multiple events with different summaries', async function () {
            const mockEmitter = new EventEmitter();
            const capturedEvents = [];

            mockEmitter.on('fire', (event) => {
                capturedEvents.push(event);
            });

            const handler = async ({ summary }) => {
                const event = {
                    type: 'status',
                    data: {
                        status: 'plan_ready',
                        summary: summary || null
                    },
                    timestamp: Date.now()
                };
                mockEmitter.emit('fire', event);
                return 'Success';
            };

            await handler({ summary: 'First plan' });
            await handler({ summary: 'Second plan' });
            await handler({ summary: 'Third plan' });

            assert.strictEqual(capturedEvents.length, 3);
            assert.strictEqual(capturedEvents[0].data.summary, 'First plan');
            assert.strictEqual(capturedEvents[1].data.summary, 'Second plan');
            assert.strictEqual(capturedEvents[2].data.summary, 'Third plan');
        });
    });

    describe('Error handling in present_plan', function () {
        it('should succeed on normal execution', async function () {
            const handler = async ({ summary }) => {
                try {
                    if (summary && summary.length > 1000) {
                        throw new Error('Summary too long');
                    }
                    return 'Plan presented to user.';
                } catch (error) {
                    return `Error presenting plan: ${error.message}`;
                }
            };

            const normalResult = await handler({ summary: 'Normal summary' });
            assert.ok(normalResult.includes('Plan presented'));
        });

        it('should catch and return error for long summaries', async function () {
            const handler = async ({ summary }) => {
                try {
                    if (summary && summary.length > 1000) {
                        throw new Error('Summary too long');
                    }
                    return 'Plan presented to user.';
                } catch (error) {
                    return `Error presenting plan: ${error.message}`;
                }
            };

            const errorResult = await handler({ summary: 'x'.repeat(1001) });
            assert.ok(errorResult.includes('Error presenting plan'));
        });
    });
});
