/**
 * Tests that plan mode exposes the skill() tool.
 *
 * Asserts against runtime exports (PLAN_MODE_AVAILABLE_TOOLS and
 * PlanModeToolsService.getAvailableToolNames()) — the actual values the
 * SDK receives. Source-string scanning was removed because it can match
 * dead code/comments and doesn't verify the production path.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');

// Mock vscode and Logger to avoid extension host deps
class MockEventEmitter { constructor(){ this.events=[]; } fire(data){ this.events.push(data); } }
class MockLogger { debug(){} info(){} warn(){} error(){} static getInstance(){ return new MockLogger(); } }
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id){
  if (id === 'vscode') { return { EventEmitter: MockEventEmitter }; }
  if (id.endsWith('/logger') || id.includes('out/logger')) { return { Logger: MockLogger }; }
  return originalRequire.apply(this, arguments);
};

const {
    PlanModeToolsService,
    PLAN_MODE_AVAILABLE_TOOLS,
} = require('../../../out/extension/services/planModeToolsService');

describe('Plan Mode — skill tool availability', () => {

    it('getAvailableToolNames includes "skill"', () => {
        const service = new PlanModeToolsService(
            'test-session-id',
            '/tmp/test-workspace',
            { fire: () => {} },
            { createTempSnapshot: () => '' },
            () => {}
        );
        const tools = service.getAvailableToolNames();
        expect(tools).to.include('skill', '"skill" must be in plan mode availableTools');
    });

    it('getSystemPrompt mentions skill tool', () => {
        const service = new PlanModeToolsService(
            'test-session-id',
            '/tmp/test-workspace',
            { fire: () => {} },
            { createTempSnapshot: () => '' },
            () => {}
        );
        const prompt = service.getSystemPrompt('test-session-id');
        expect(prompt).to.include('skill', 'system prompt must document the skill tool');
    });

    it('PLAN_MODE_AVAILABLE_TOOLS constant includes "skill"', () => {
        // This is the actual array sdkSessionManager passes to the SDK as
        // `availableTools`. Asserting on the exported constant verifies the
        // production code path rather than the source file representation.
        expect(PLAN_MODE_AVAILABLE_TOOLS).to.include('skill',
            'PLAN_MODE_AVAILABLE_TOOLS (the SDK whitelist) must include "skill"');
    });
});
