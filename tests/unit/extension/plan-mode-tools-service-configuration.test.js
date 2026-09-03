/**
 * Tests for PlanModeToolsService configuration methods
 * Phase 3.0: Configuration abstraction pattern
 * 
 * Tests the new getAvailableToolNames() and getSystemPrompt() methods
 * that remove hard-coded configuration from sdkSessionManager.ts
 * 
 * TDD: RED -> GREEN -> REFACTOR
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const os = require('os');

// The real service, not a copy of it.
//
// This file used to define its own `PlanModeToolsService` -- a "GREEN phase:
// Minimal implementation to pass tests" that was never replaced. It duplicated the
// tool list and the system prompt verbatim, so every assertion here checked a copy
// against itself. That is why it kept passing while the shipped whitelist named two
// tools the CLI does not have (`report_intent`, `fetch_copilot_cli_documentation`)
// -- only a live run surfaced those.
//
// CLAUDE.md: tests must import production code, not mocks.
const { PlanModeToolsService: RealPlanModeToolsService } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'services', 'planModeToolsService.js')
);

/**
 * Adapter keeping the three-argument shape the tests below use.
 *
 * `getAvailableToolNames()` and `getSystemPrompt()` touch none of the remaining
 * collaborators -- no SDK, no snapshots, no diffing -- so they are stubbed to the
 * minimum the constructor demands. `initialize()` is deliberately never called: it
 * loads the SDK to build the custom tools, and neither method under test needs them.
 */
class PlanModeToolsService {
    constructor(workSessionId, workingDirectory, onDidChangeStatus) {
        return new RealPlanModeToolsService(
            workSessionId,
            workingDirectory,
            onDidChangeStatus,
            null,
            () => {},
            { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
        );
    }
}

describe('PlanModeToolsService - Configuration Methods', () => {
    describe('getAvailableToolNames()', () => {
        it('should return array of 12 tool names', () => {
            const service = new PlanModeToolsService(
                'test-session-id',
                '/test/workdir',
                { fire: () => {} }
            );
            
            const toolNames = service.getAvailableToolNames();
            
            expect(toolNames).to.be.an('array');
            // 6 custom + 5 safe SDK tools. Was 12 until `report_intent` and
            // `fetch_copilot_cli_documentation` were removed: the CLI rejects both.
            expect(toolNames).to.have.lengthOf(11);
        });
        
        it('should include all 6 custom plan mode tools', () => {
            const service = new PlanModeToolsService(
                'test-session-id',
                '/test/workdir',
                { fire: () => {} }
            );
            
            const toolNames = service.getAvailableToolNames();
            const customTools = [
                'plan_bash_explore',
                'task_agent_type_explore',
                'edit_plan_file',
                'create_plan_file',
                'update_work_plan',
                'present_plan'
            ];
            
            for (const tool of customTools) {
                expect(toolNames).to.include(tool);
            }
        });
        
        it('should include all 5 safe SDK tools', () => {
            const service = new PlanModeToolsService(
                'test-session-id',
                '/test/workdir',
                { fire: () => {} }
            );
            
            const toolNames = service.getAvailableToolNames();
            const sdkTools = [
                'view',
                'grep',
                'glob',
                'web_fetch'
            ];
            
            for (const tool of sdkTools) {
                expect(toolNames).to.include(tool);
            }
        });
        
        it('lists no tool the CLI does not have', () => {
            // The whitelist is an allowlist the CLI validates. Naming a tool it does
            // not have earns a `session.info` configuration warning --
            //
            //   Unknown tool name in the tool allowlist: "report_intent"
            //   Unknown tool name in the tool allowlist: "fetch_copilot_cli_documentation"
            //
            // -- observed on CLI 1.0.80. Worse than noise: both were also advertised
            // to the model in the plan-mode system prompt, so it was told it had
            // tools it could never call.
            //
            // Neither is one of this service's custom tools; both were assumed to be
            // CLI built-ins and are not. If a future CLI reintroduces them, add them
            // back here and to the prompt together.
            const service = new PlanModeToolsService(
                'test-session-id',
                '/test/workdir',
                { fire: () => {} }
            );

            const toolNames = service.getAvailableToolNames();

            expect(toolNames).to.not.include('report_intent');
            expect(toolNames).to.not.include('fetch_copilot_cli_documentation');
        });

        it('does not advertise a removed tool in the system prompt', () => {
            const service = new PlanModeToolsService(
                'test-session-id',
                '/test/workdir',
                { fire: () => {} }
            );

            const prompt = service.getSystemPrompt('work-id');

            expect(prompt).to.not.include('report_intent');
            expect(prompt).to.not.include('fetch_copilot_cli_documentation');
        });
    });
    
    describe('getSystemPrompt()', () => {
        it('should generate prompt with correct plan path', () => {
            const sessionId = 'abc123-work';
            const service = new PlanModeToolsService(
                sessionId,
                '/test/workdir',
                { fire: () => {} }
            );
            
            const prompt = service.getSystemPrompt(sessionId);
            const expectedPath = path.join(
                os.homedir(),
                '.copilot',
                'session-state',
                sessionId,
                'plan.md'
            );
            
            expect(prompt).to.include(expectedPath);
        });
        
        it('should include correct session ID in path', () => {
            const sessionId = 'xyz789-work';
            const service = new PlanModeToolsService(
                'different-id',
                '/test/workdir',
                { fire: () => {} }
            );
            
            const prompt = service.getSystemPrompt(sessionId);
            
            expect(prompt).to.include(sessionId);
            expect(prompt).to.include(path.join('session-state', sessionId, 'plan.md'));
        });
        
        it('should include all tool descriptions', () => {
            const service = new PlanModeToolsService(
                'test-session-id',
                '/test/workdir',
                { fire: () => {} }
            );
            
            const prompt = service.getSystemPrompt('test-session-id');
            
            // Check for key tool descriptions
            expect(prompt).to.include('update_work_plan');
            expect(prompt).to.include('present_plan');
            expect(prompt).to.include('plan_bash_explore');
            expect(prompt).to.include('task_agent_type_explore');
            expect(prompt).to.include('view');
            expect(prompt).to.include('grep');
            expect(prompt).to.include('glob');
        });
        
        it('should include workflow instructions', () => {
            const service = new PlanModeToolsService(
                'test-session-id',
                '/test/workdir',
                { fire: () => {} }
            );
            
            const prompt = service.getSystemPrompt('test-session-id');
            
            // Check for workflow keywords
            expect(prompt).to.include('WORKFLOW');
            expect(prompt).to.include('Explore and analyze');
            expect(prompt).to.include('Create/update your plan');
            expect(prompt).to.include('present_plan');
        });
        
        it('should include restrictions and security guidelines', () => {
            const service = new PlanModeToolsService(
                'test-session-id',
                '/test/workdir',
                { fire: () => {} }
            );
            
            const prompt = service.getSystemPrompt('test-session-id');
            
            // Check for restriction keywords
            expect(prompt).to.include('CANNOT');
            expect(prompt).to.include('READ-ONLY');
            expect(prompt).to.include('BASH COMMAND RESTRICTIONS');
            expect(prompt).to.include('Allowed commands');
            expect(prompt).to.include('Blocked commands');
        });
    });
});
