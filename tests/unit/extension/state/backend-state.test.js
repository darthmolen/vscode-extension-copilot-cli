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
        it('should calculate session duration in seconds', (done) => {
            state.setSessionActive(true);
            
            // Wait 100ms to get measurable duration
            setTimeout(() => {
                const duration = state.getSessionDuration();
                expect(duration).to.be.a('number');
                expect(duration).to.be.at.least(0);
                expect(duration).to.be.at.most(1); // Should be less than 1 second
                done();
            }, 100);
        });

        it('should return 0 when no session has started', () => {
            const duration = state.getSessionDuration();
            expect(duration).to.equal(0);
        });

        it('should return duration even when session is inactive', (done) => {
            state.setSessionActive(true);
            
            setTimeout(() => {
                state.setSessionActive(false);
                const duration = state.getSessionDuration();
                expect(duration).to.be.greaterThan(0);
                done();
            }, 100);
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
