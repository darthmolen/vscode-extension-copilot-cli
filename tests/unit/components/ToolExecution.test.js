/**
 * ToolExecution Component Tests
 * 
 * Tests the ToolExecution component for rendering tool groups,
 * tool execution states, expand/collapse, and diff buttons.
 * 
 * TDD: RED phase - these tests should FAIL until ToolExecution is implemented.
 */

import { expect } from 'chai';
import { JSDOM } from 'jsdom';

describe('ToolExecution Component', () => {
    let dom;
    let ToolExecution;
    let EventBus;
    let container;
    let eventBus;

    before(async () => {
        // Setup DOM environment inside describe to avoid conflicts with other test files
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        global.window = dom.window;
        global.document = dom.window.document;

        const execModule = await import('../../../src/webview/app/components/ToolExecution/ToolExecution.js');
        ToolExecution = execModule.ToolExecution;

        const busModule = await import('../../../src/webview/app/state/EventBus.js');
        EventBus = busModule.EventBus;
    });

    after(() => {
        delete global.window;
        delete global.document;
        if (dom && dom.window) {
            dom.window.close();
        }
    });

    beforeEach(() => {
        // Create fresh container for each test
        container = document.createElement('div');
        container.id = 'messages';
        document.body.appendChild(container);
        
        eventBus = new EventBus();
    });

    afterEach(() => {
        // Cleanup
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
    });

    describe('Component initialization', () => {
        it('should create a ToolExecution instance', () => {
            const toolExec = new ToolExecution(container, eventBus);
            
            expect(toolExec).to.exist;
            expect(toolExec).to.be.instanceOf(ToolExecution);
        });

        it('should have no tool groups initially', () => {
            new ToolExecution(container, eventBus);
            
            const toolGroups = container.querySelectorAll('.tool-execution__group');
            expect(toolGroups).to.have.length(0);
        });
    });

    describe('Tool group creation', () => {
        it('should create tool group on first tool:start event', () => {
            const toolExec = new ToolExecution(container, eventBus);
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                arguments: { command: 'ls -la' },
                startTime: Date.now()
            });
            
            const toolGroup = container.querySelector('.tool-execution__group');
            expect(toolGroup).to.exist;
        });

        it('should add multiple tools to same group', () => {
            const toolExec = new ToolExecution(container, eventBus);
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                arguments: { command: 'ls' },
                startTime: Date.now()
            });
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-2',
                toolName: 'grep',
                arguments: { pattern: 'test' },
                startTime: Date.now()
            });
            
            const toolGroups = container.querySelectorAll('.tool-execution__group');
            expect(toolGroups).to.have.length(1); // Same group
            
            const tools = container.querySelectorAll('.tool-execution__item');
            expect(tools).to.have.length(2);
        });

        it('should close current group when user message:add event received', () => {
            const toolExec = new ToolExecution(container, eventBus);

            // Add tool to group
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                startTime: Date.now()
            });

            // User message closes the group
            eventBus.emit('message:add', {
                role: 'user',
                content: 'Test',
                timestamp: Date.now()
            });

            // Next tool starts a NEW group
            eventBus.emit('tool:start', {
                toolCallId: 'tool-2',
                toolName: 'bash',
                startTime: Date.now()
            });

            const toolGroups = container.querySelectorAll('.tool-execution__group');
            expect(toolGroups).to.have.length(2);

            expect(toolGroups[0].querySelectorAll('.tool-execution__item')).to.have.length(1);
            expect(toolGroups[1].querySelectorAll('.tool-execution__item')).to.have.length(1);
        });
    });

    describe('Tool state rendering', () => {
        it('should render running tool with pending icon', () => {
            const toolExec = new ToolExecution(container, eventBus);
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                arguments: { command: 'sleep 10' },
                status: 'running',
                startTime: Date.now()
            });
            
            const tool = container.querySelector('[data-tool-id="tool-1"]');
            expect(tool).to.exist;
            expect(tool.textContent).to.include('⏳'); // Running icon
            expect(tool.textContent).to.include('bash');
        });

        it('should update tool status when tool:complete received', () => {
            const toolExec = new ToolExecution(container, eventBus);
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                status: 'running',
                startTime: 1000
            });
            
            eventBus.emit('tool:complete', {
                toolCallId: 'tool-1',
                status: 'complete',
                result: 'Success!',
                endTime: 2000
            });
            
            const tool = container.querySelector('[data-tool-id="tool-1"]');
            expect(tool.textContent).to.include('✅'); // Success icon
            expect(tool.textContent).to.include('1.00s'); // Duration
        });

        it('should render failed tool with error icon', () => {
            const toolExec = new ToolExecution(container, eventBus);
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                status: 'running',
                startTime: 1000
            });
            
            eventBus.emit('tool:complete', {
                toolCallId: 'tool-1',
                status: 'failed',
                error: { message: 'Command failed' },
                endTime: 2000
            });
            
            const tool = container.querySelector('[data-tool-id="tool-1"]');
            expect(tool.textContent).to.include('❌'); // Error icon
        });

        it('should render tool arguments preview', () => {
            const toolExec = new ToolExecution(container, eventBus);
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                arguments: { command: 'ls -la' },
                status: 'running',
                startTime: Date.now()
            });
            
            const tool = container.querySelector('[data-tool-id="tool-1"]');
            expect(tool.textContent).to.include('$ ls -la');
        });

        it('should render tool intent if provided', () => {
            const toolExec = new ToolExecution(container, eventBus);
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                arguments: { command: 'ls' },
                intent: 'List files',
                status: 'running',
                startTime: Date.now()
            });
            
            const tool = container.querySelector('[data-tool-id="tool-1"]');
            expect(tool.textContent).to.include('List files');
        });
    });

    describe('Tool details expansion', () => {
        it('should include details element for tools with arguments', () => {
            const toolExec = new ToolExecution(container, eventBus);
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                arguments: { command: 'ls' },
                startTime: Date.now()
            });
            
            const details = container.querySelector('.tool-execution__details');
            expect(details).to.exist;
        });

        it('should show result in details when tool completes', () => {
            const toolExec = new ToolExecution(container, eventBus);
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                arguments: { command: 'ls' },
                startTime: 1000
            });
            
            eventBus.emit('tool:complete', {
                toolCallId: 'tool-1',
                status: 'complete',
                result: 'file1.txt\nfile2.txt',
                endTime: 2000
            });
            
            const tool = container.querySelector('[data-tool-id="tool-1"]');
            expect(tool.textContent).to.include('file1.txt');
        });

        it('should show error in details when tool fails', () => {
            const toolExec = new ToolExecution(container, eventBus);
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                arguments: { command: 'invalid' },
                startTime: 1000
            });
            
            eventBus.emit('tool:complete', {
                toolCallId: 'tool-1',
                status: 'failed',
                error: { message: 'Command not found', code: 127 },
                endTime: 2000
            });
            
            const tool = container.querySelector('[data-tool-id="tool-1"]');
            expect(tool.textContent).to.include('Command not found');
            expect(tool.textContent).to.include('127');
        });
    });

    describe('Diff button functionality', () => {
        it('should render diff button when hasDiff is true', () => {
            const toolExec = new ToolExecution(container, eventBus);
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'edit',
                hasDiff: true,
                diffData: {
                    beforeUri: '/tmp/before.txt',
                    afterUri: '/workspace/after.txt'
                },
                startTime: Date.now()
            });
            
            const diffBtn = container.querySelector('.tool-execution__diff-btn');
            expect(diffBtn).to.exist;
            expect(diffBtn.textContent).to.include('View Diff');
        });

        it('should emit viewDiff event when diff button clicked', (done) => {
            const toolExec = new ToolExecution(container, eventBus);
            
            eventBus.on('viewDiff', (data) => {
                expect(data.toolCallId).to.equal('tool-1');
                expect(data.beforeUri).to.equal('/tmp/before.txt');
                done();
            });
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'edit',
                hasDiff: true,
                diffData: {
                    toolCallId: 'tool-1',
                    beforeUri: '/tmp/before.txt',
                    afterUri: '/workspace/after.txt'
                },
                startTime: Date.now()
            });
            
            const diffBtn = container.querySelector('.tool-execution__diff-btn');
            diffBtn.click();
        });

        it('should NOT render diff button when hasDiff is false', () => {
            const toolExec = new ToolExecution(container, eventBus);
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                hasDiff: false,
                startTime: Date.now()
            });
            
            const diffBtn = container.querySelector('.tool-execution__diff-btn');
            expect(diffBtn).to.not.exist;
        });
    });

    describe('Tool group expand/collapse', () => {
        it('should add collapse toggle when tools exceed height threshold', () => {
            const toolExec = new ToolExecution(container, eventBus);
            
            // Add many tools to trigger collapse
            for (let i = 0; i < 10; i++) {
                eventBus.emit('tool:start', {
                    toolCallId: `tool-${i}`,
                    toolName: 'bash',
                    arguments: { command: `command ${i}` },
                    startTime: Date.now()
                });
            }
            
            const toggle = container.querySelector('.tool-execution__toggle');
            expect(toggle).to.exist;
            expect(toggle.textContent).to.include('Expand');
        });

        it('should expand/contract group when toggle clicked', () => {
            const toolExec = new ToolExecution(container, eventBus);
            
            // Add many tools
            for (let i = 0; i < 10; i++) {
                eventBus.emit('tool:start', {
                    toolCallId: `tool-${i}`,
                    toolName: 'bash',
                    startTime: Date.now()
                });
            }
            
            const toggle = container.querySelector('.tool-execution__toggle');
            const groupContainer = container.querySelector('.tool-execution__container');
            
            // Initially collapsed
            expect(groupContainer.classList.contains('expanded')).to.be.false;
            
            // Click to expand
            toggle.click();
            expect(groupContainer.classList.contains('expanded')).to.be.true;
            expect(toggle.textContent).to.include('Contract');
            
            // Click to collapse
            toggle.click();
            expect(groupContainer.classList.contains('expanded')).to.be.false;
            expect(toggle.textContent).to.include('Expand');
        });
    });

    describe('Tool progress updates', () => {
        it('should update tool with progress message', () => {
            const toolExec = new ToolExecution(container, eventBus);
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                status: 'running',
                startTime: Date.now()
            });
            
            eventBus.emit('tool:progress', {
                toolCallId: 'tool-1',
                progress: 'Processing file 5 of 10...'
            });
            
            const tool = container.querySelector('[data-tool-id="tool-1"]');
            expect(tool.textContent).to.include('Processing file 5 of 10');
        });
    });
});
