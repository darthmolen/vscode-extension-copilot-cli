/**
 * Event Inspector
 *
 * Captures and analyzes SDK events. Provides streaming analysis
 * (batching detection) extracted from the original test harness.
 */

/**
 * Create an event inspector that attaches to a session.
 * @param {object} session - Copilot SDK session
 * @param {{ verbose?: boolean, events?: string[] }} options
 * @returns {EventInspector}
 */
export function createInspector(session, options = {}) {
    return new EventInspector(session, options);
}

class EventInspector {
    constructor(session, options = {}) {
        this.session = session;
        this.verbose = options.verbose || false;
        this.eventFilter = options.events || ['all'];
        this.captured = [];
        this.chunkTimestamps = [];
        this.toolExecutions = [];
        this.lastMessageTime = Date.now();
        this.response = null;

        this._attach();
    }

    _shouldCapture(eventType) {
        if (this.eventFilter.includes('all')) return true;
        return this.eventFilter.some(f => eventType.startsWith(f));
    }

    _record(type, data) {
        const entry = {
            type,
            timestamp: Date.now(),
            elapsed: Date.now() - this.lastMessageTime,
            data,
        };
        this.captured.push(entry);
        return entry;
    }

    _attach() {
        this.session.on('assistant.message_delta', (event) => {
            const now = Date.now();
            const deltaMs = now - this.lastMessageTime;
            this.lastMessageTime = now;

            this.chunkTimestamps.push({
                timestamp: now,
                deltaMs,
                size: event.data?.deltaContent?.length || 0,
            });

            if (this._shouldCapture('assistant')) {
                this._record('assistant.message_delta', {
                    deltaMs,
                    size: event.data?.deltaContent?.length || 0,
                    content: this.verbose ? event.data?.deltaContent : undefined,
                });
            }
        });

        this.session.on('assistant.message', (event) => {
            this.response = event.data?.content;
            if (this._shouldCapture('assistant')) {
                this._record('assistant.message', {
                    contentLength: event.data?.content?.length || 0,
                    toolRequests: event.data?.toolRequests?.length || 0,
                });
            }
        });

        this.session.on('assistant.reasoning', (event) => {
            if (this._shouldCapture('assistant')) {
                this._record('assistant.reasoning', {
                    contentLength: event.data?.content?.length || 0,
                    content: this.verbose ? event.data?.content : undefined,
                });
            }
        });

        this.session.on('tool.execution_start', (event) => {
            this.toolExecutions.push({
                toolCallId: event.data?.toolCallId,
                toolName: event.data?.toolName,
                startTime: Date.now(),
                status: 'started',
            });

            if (this._shouldCapture('tool')) {
                this._record('tool.execution_start', {
                    toolName: event.data?.toolName,
                    toolCallId: event.data?.toolCallId,
                });
            }
        });

        this.session.on('tool.execution_complete', (event) => {
            const exec = this.toolExecutions.find(
                t => t.toolCallId === event.data?.toolCallId
            );
            if (exec) {
                exec.endTime = Date.now();
                exec.durationMs = exec.endTime - exec.startTime;
                exec.status = event.data?.success ? 'complete' : 'failed';
            }

            if (this._shouldCapture('tool')) {
                this._record('tool.execution_complete', {
                    toolName: event.data?.toolName,
                    toolCallId: event.data?.toolCallId,
                    success: event.data?.success,
                    durationMs: exec?.durationMs,
                });
            }
        });

        this.session.on('session.error', (event) => {
            if (this._shouldCapture('session')) {
                this._record('session.error', {
                    message: event.data?.message,
                });
            }
        });
    }

    /**
     * Analyze streaming quality from captured chunk timestamps.
     */
    analyzeStreaming() {
        const chunks = this.chunkTimestamps;

        if (!chunks || chunks.length === 0) {
            return { valid: false, reason: 'No chunks received' };
        }

        const deltas = chunks.map(c => c.deltaMs).filter(d => d > 0);
        if (deltas.length === 0) {
            return { valid: false, reason: 'No valid deltas' };
        }

        const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        const maxDelta = Math.max(...deltas);
        const minDelta = Math.min(...deltas);

        // Batching detection: long gaps followed by many quick chunks
        const largePauses = deltas.filter(d => d > 5000).length;
        const quickBursts = deltas.filter(d => d < 50).length;

        const isBatched = largePauses > 0 && quickBursts > 10;
        const isSmooth = avgDelta < 200 && maxDelta < 1000;

        return {
            valid: true,
            totalChunks: chunks.length,
            avgDeltaMs: Math.round(avgDelta),
            maxDeltaMs: maxDelta,
            minDeltaMs: minDelta,
            largePauses,
            quickBursts,
            isBatched,
            isSmooth,
            assessment: isBatched ? 'BATCHED' : isSmooth ? 'SMOOTH' : 'IRREGULAR',
        };
    }

    /**
     * Reset captured data for a new test run.
     */
    reset() {
        this.captured = [];
        this.chunkTimestamps = [];
        this.toolExecutions = [];
        this.lastMessageTime = Date.now();
        this.response = null;
    }

    /**
     * Get a summary of all captured events.
     */
    summary() {
        const types = {};
        for (const e of this.captured) {
            types[e.type] = (types[e.type] || 0) + 1;
        }

        return {
            totalEvents: this.captured.length,
            eventCounts: types,
            toolExecutions: this.toolExecutions.length,
            streamingAnalysis: this.analyzeStreaming(),
            responseLength: this.response?.length || 0,
        };
    }
}
