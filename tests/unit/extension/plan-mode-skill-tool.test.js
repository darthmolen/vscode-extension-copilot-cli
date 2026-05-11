/**
 * Tests that plan mode exposes the skill() tool
 * 
 * TDD RED PHASE: skill must be in getAvailableToolNames()
 * and in the hardcoded availableTools lists in sdkSessionManager.ts
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const fs = require('fs');

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

const { PlanModeToolsService } = require('../../../out/extension/services/planModeToolsService');

describe('Plan Mode — skill tool availability', () => {

    it('getAvailableToolNames includes "skill"', () => {
        const service = new PlanModeToolsService(
            () => {},
            () => {},
            { fire: () => {} },
            '/tmp/test-workspace'
        );
        const tools = service.getAvailableToolNames();
        expect(tools).to.include('skill', '"skill" must be in plan mode availableTools');
    });

    it('getSystemPrompt mentions skill tool', () => {
        const service = new PlanModeToolsService(
            () => {},
            () => {},
            { fire: () => {} },
            '/tmp/test-workspace'
        );
        const prompt = service.getSystemPrompt('test-session-id');
        expect(prompt).to.include('skill', 'system prompt must document the skill tool');
    });

    it('sdkSessionManager hardcoded availableTools lists include "skill"', () => {
        const src = fs.readFileSync(
            require('path').join(__dirname, '../../../src/sdkSessionManager.ts'),
            'utf-8'
        );

        // Find literal (non-template) availableTools arrays
        const availableToolsBlocks = [];
        let searchFrom = 0;
        while (true) {
            const idx = src.indexOf("availableTools: [", searchFrom);
            if (idx === -1) break;
            const end = src.indexOf(']', idx);
            const block = src.slice(idx, end + 1);
            // Skip template literals and constant-spread references — those are correct
            if (!block.includes('${') && !block.includes('PLAN_MODE_AVAILABLE_TOOLS')) {
                availableToolsBlocks.push(block);
            }
            searchFrom = idx + 1;
        }

        // The DRY refactor should have eliminated all literal lists.
        // If any remain, they must include 'skill'.
        for (const block of availableToolsBlocks) {
            expect(block).to.include("'skill'",
                `Literal availableTools list in sdkSessionManager.ts missing 'skill':\n${block}`);
        }

        // Verify the constant import exists (the real source of truth)
        expect(src).to.include('PLAN_MODE_AVAILABLE_TOOLS',
            'sdkSessionManager.ts must import PLAN_MODE_AVAILABLE_TOOLS');
    });
});
