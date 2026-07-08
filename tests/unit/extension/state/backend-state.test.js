/**
 * Tests for BackendState session tracking
 * Task 4: Session start time and metrics tracking
 */

const { expect } = require('chai');
const path = require('path');

describe('BackendState - Session Tracking', () => {
    let BackendState;

    before(async () => {
        const modulePath = path.join(__dirname, '../../../../out/backendState.js');
        const module = require(modulePath);
        BackendState = module.BackendState;
    });

    let state;

    beforeEach(() => {
        state = new BackendState();
    });

    describe('Session Start Time Tracking', () => {
        it('should track session start time when session becomes active', () => {
            const beforeStart = Date.now();
            state.setSessionActive(true);
            const afterStart = Date.now();

            const startTime = state.getSessionStartTime();
            expect(startTime).to.be.a('number');
            expect(startTime).to.be.at.least(beforeStart);
            expect(startTime).to.be.at.most(afterStart);
        });

        it('should return null when no session has started', () => {
            const startTime = state.getSessionStartTime();
            expect(startTime).to.be.null;
        });

        it('should preserve session start time when session becomes inactive', () => {
            state.setSessionActive(true);
            const originalStartTime = state.getSessionStartTime();

            state.setSessionActive(false);
            const afterInactive = state.getSessionStartTime();

            expect(afterInactive).to.equal(originalStartTime);
        });

        it('should reset session start time when reset() is called', () => {
            state.setSessionActive(true);
            expect(state.getSessionStartTime()).to.not.be.null;

            state.reset();
            expect(state.getSessionStartTime()).to.be.null;
        });
    });

    describe('Session Duration Calculation', () => {
        // Stub Date.now instead of sleeping on a real timer: duration is pure
        // `(Date.now() - startTime)/1000` math, and a real wall clock can jump backward
        // mid-run (WSL/NTP skew) making elapsed time negative — a flake under full-suite load.
        // Controlling the clock tests the actual math deterministically.
        let realNow;
        let now;
        beforeEach(() => {
            realNow = Date.now;
            now = 1_700_000_000_000;
            Date.now = () => now;
        });
        afterEach(() => { Date.now = realNow; });

        it('should calculate session duration in seconds', () => {
            state.setSessionActive(true);   // startTime = now
            now += 100;                      // advance 100ms deterministically
            const duration = state.getSessionDuration();
            expect(duration).to.be.a('number');
            expect(duration).to.be.closeTo(0.1, 1e-9);   // 100ms → 0.1s
        });

        it('should return 0 when no session has started', () => {
            const duration = state.getSessionDuration();
            expect(duration).to.equal(0);
        });

        it('should return duration even when session is inactive', () => {
            state.setSessionActive(true);
            now += 100;
            state.setSessionActive(false);   // deactivate does not clear startTime
            const duration = state.getSessionDuration();
            expect(duration).to.be.greaterThan(0);
        });
    });

    describe('Message and Tool Counts', () => {
        it('should count user messages', () => {
            state.addMessage({ role: 'user', type: 'user', content: 'Hello' });
            state.addMessage({ role: 'user', type: 'user', content: 'World' });
            state.addMessage({ role: 'assistant', type: 'assistant', content: 'Hi' });

            const count = state.getMessageCount();
            expect(count).to.equal(3);
        });

        it('should return 0 when no messages', () => {
            const count = state.getMessageCount();
            expect(count).to.equal(0);
        });

        it('should count tool executions', () => {
            state.addMessage({ role: 'assistant', type: 'tool', content: 'bash', toolName: 'bash', status: 'running' });
            state.addMessage({ role: 'assistant', type: 'tool', content: 'view', toolName: 'view', status: 'success' });
            state.addMessage({ role: 'user', type: 'user', content: 'Hello' });

            const count = state.getToolCallCount();
            expect(count).to.equal(2);
        });

        it('should return 0 when no tool calls', () => {
            state.addMessage({ role: 'user', type: 'user', content: 'Hello' });
            const count = state.getToolCallCount();
            expect(count).to.equal(0);
        });

        it('should reset counts when reset() is called', () => {
            state.addMessage({ role: 'user', type: 'user', content: 'Hello' });
            state.addMessage({ role: 'assistant', type: 'tool', content: 'bash', toolName: 'bash' });

            state.reset();

            expect(state.getMessageCount()).to.equal(0);
            expect(state.getToolCallCount()).to.equal(0);
        });
    });

    describe('Current Model Reset', () => {
        it('should reset currentModel when reset() is called', () => {
            state.setCurrentModel('claude-opus-4.5');
            expect(state.getCurrentModel()).to.equal('claude-opus-4.5');

            state.reset();
            expect(state.getCurrentModel()).to.be.null;
        });
    });
});

describe('BackendState - MCP Tool Tracking', () => {
    let BackendState;

    before(async () => {
        const path = require('path');
        const modulePath = path.join(__dirname, '../../../../out/backendState.js');
        const module = require(modulePath);
        BackendState = module.BackendState;
    });

    let state;

    beforeEach(() => {
        state = new BackendState();
    });

    it('returns empty object when no tools recorded', () => {
        expect(state.getMcpServerTools()).to.deep.equal({});
    });

    it('stores tools per server key', () => {
        state.setMcpServerTools('_copilotcli_playwright', ['screenshot', 'navigate', 'click']);
        const tools = state.getMcpServerTools();
        expect(tools['_copilotcli_playwright']).to.deep.equal(['screenshot', 'navigate', 'click']);
    });

    it('stores multiple servers independently', () => {
        state.setMcpServerTools('_copilotcli_playwright', ['screenshot']);
        state.setMcpServerTools('filesystem', ['read_file', 'write_file']);
        const tools = state.getMcpServerTools();
        expect(tools['_copilotcli_playwright']).to.deep.equal(['screenshot']);
        expect(tools['filesystem']).to.deep.equal(['read_file', 'write_file']);
    });

    it('overwrites on repeated set for same server', () => {
        state.setMcpServerTools('server1', ['tool_a']);
        state.setMcpServerTools('server1', ['tool_b', 'tool_c']);
        expect(state.getMcpServerTools()['server1']).to.deep.equal(['tool_b', 'tool_c']);
    });

    it('returns a copy — mutations do not affect internal state', () => {
        state.setMcpServerTools('server1', ['tool_a']);
        const copy = state.getMcpServerTools();
        copy['server1'] = ['mutated'];
        expect(state.getMcpServerTools()['server1']).to.deep.equal(['tool_a']);
    });

    it('clears tools on clearSession()', () => {
        state.setMcpServerTools('_copilotcli_playwright', ['screenshot']);
        state.clearSession();
        expect(state.getMcpServerTools()).to.deep.equal({});
    });
});
