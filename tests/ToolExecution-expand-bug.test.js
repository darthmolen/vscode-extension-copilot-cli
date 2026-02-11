import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { ToolExecution } from '../src/webview/app/components/ToolExecution/ToolExecution.js';
import { EventBus } from '../src/webview/app/state/EventBus.js';

describe('ToolExecution - Expand/Contract After Message Bug', () => {
    let dom, container, eventBus, toolExecution;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><div id="container"></div>');
        global.window = dom.window;
        global.document = dom.window.document;
        
        container = document.getElementById('container');
        eventBus = new EventBus();
        toolExecution = new ToolExecution(container, eventBus);
    });

    afterEach(() => {
        delete global.window;
        delete global.document;
    });

    describe('Bug Reproduction: Toggle Breaks After New Message', () => {
        it('should expand/contract tools initially', () => {
            // Start a tool group with multiple tools to trigger overflow
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                arguments: { command: 'ls' },
                status: 'running',
                startTime: Date.now()
            });
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-2',
                toolName: 'bash',
                arguments: { command: 'pwd' },
                status: 'running',
                startTime: Date.now()
            });
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-3',
                toolName: 'bash',
                arguments: { command: 'whoami' },
                status: 'running',
                startTime: Date.now()
            });
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-4',
                toolName: 'bash',
                arguments: { command: 'date' },
                status: 'running',
                startTime: Date.now()
            });
            
            // Should create expand button (4 tools > 3 threshold)
            const expandBtn = container.querySelector('.tool-group-toggle');
            expect(expandBtn, 'Expand button should exist').to.exist;
            expect(expandBtn.textContent).to.include('Expand');
            
            // Container should be collapsed
            const toolContainer = container.querySelector('.tool-group-container');
            expect(toolContainer.classList.contains('expanded')).to.be.false;
            
            // Click to expand
            expandBtn.click();
            
            // Should be expanded
            expect(toolContainer.classList.contains('expanded')).to.be.true;
            expect(expandBtn.textContent).to.equal('Contract');
            
            // Click to contract
            expandBtn.click();
            
            // Should be contracted
            expect(toolContainer.classList.contains('expanded')).to.be.false;
            expect(expandBtn.textContent).to.include('Expand');
        });

        it('should still expand/contract after new message arrives', () => {
            // Create tool group
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                arguments: { command: 'ls' },
                status: 'running',
                startTime: Date.now()
            });
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-2',
                toolName: 'bash',
                arguments: { command: 'pwd' },
                status: 'running',
                startTime: Date.now()
            });
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-3',
                toolName: 'bash',
                arguments: { command: 'whoami' },
                status: 'running',
                startTime: Date.now()
            });
            
            eventBus.emit('tool:start', {
                toolCallId: 'tool-4',
                toolName: 'bash',
                arguments: { command: 'date' },
                status: 'running',
                startTime: Date.now()
            });
            
            const toolGroup = container.querySelector('.tool-group');
            const expandBtn = toolGroup.querySelector('.tool-group-toggle');
            const toolContainer = toolGroup.querySelector('.tool-group-container');
            
            // Expand initially
            expandBtn.click();
            expect(toolContainer.classList.contains('expanded'), 'Should be expanded after first click').to.be.true;
            
            // NEW MESSAGE ARRIVES - this triggers closeCurrentToolGroup()
            eventBus.emit('message:add', {
                role: 'assistant',
                content: 'Done!',
                timestamp: Date.now()
            });
            
            // BUG: After message arrives, toggle should STILL work
            // but currently it breaks because currentToolGroup is null
            
            // Try to contract
            expandBtn.click();
            
            // Should be contracted (THIS IS WHERE THE BUG MANIFESTS)
            expect(toolContainer.classList.contains('expanded'), 'Container should be contracted after clicking toggle').to.be.false;
            expect(expandBtn.textContent).to.include('Expand');
            
            // Try to expand again
            expandBtn.click();
            
            // Should be expanded again
            expect(toolContainer.classList.contains('expanded'), 'Container should be expanded after clicking toggle again').to.be.true;
            expect(expandBtn.textContent).to.equal('Contract');
        });

        it('should handle multiple expand/contract cycles after message', () => {
            // Create tool group
            for (let i = 1; i <= 5; i++) {
                eventBus.emit('tool:start', {
                    toolCallId: `tool-${i}`,
                    toolName: 'bash',
                    status: 'running',
                    startTime: Date.now()
                });
            }
            
            const expandBtn = container.querySelector('.tool-group-toggle');
            const toolContainer = container.querySelector('.tool-group-container');
            
            // Message arrives
            eventBus.emit('message:add', {
                role: 'user',
                content: 'Next command',
                timestamp: Date.now()
            });
            
            // Multiple expand/contract cycles
            for (let cycle = 0; cycle < 3; cycle++) {
                // Expand
                expandBtn.click();
                expect(toolContainer.classList.contains('expanded'), `Cycle ${cycle}: should be expanded`).to.be.true;
                
                // Contract
                expandBtn.click();
                expect(toolContainer.classList.contains('expanded'), `Cycle ${cycle}: should be contracted`).to.be.false;
            }
        });
    });

    describe('Edge Cases', () => {
        it('should not break if toggle clicked rapidly', () => {
            // Create tool group
            for (let i = 1; i <= 4; i++) {
                eventBus.emit('tool:start', {
                    toolCallId: `tool-${i}`,
                    toolName: 'bash',
                    status: 'running',
                    startTime: Date.now()
                });
            }
            
            const expandBtn = container.querySelector('.tool-group-toggle');
            const toolContainer = container.querySelector('.tool-group-container');
            
            // Rapid clicks
            expandBtn.click();
            expandBtn.click();
            expandBtn.click();
            expandBtn.click();
            
            // Should be contracted (even number of clicks)
            expect(toolContainer.classList.contains('expanded')).to.be.false;
        });

        it('should work with tool group that has exactly 3 tools', () => {
            // Exactly at threshold - should still overflow
            for (let i = 1; i <= 3; i++) {
                eventBus.emit('tool:start', {
                    toolCallId: `tool-${i}`,
                    toolName: 'bash',
                    status: 'running',
                    startTime: Date.now()
                });
            }
            
            const expandBtn = container.querySelector('.tool-group-toggle');
            
            if (expandBtn) {
                eventBus.emit('message:add', {
                    role: 'assistant',
                    content: 'Done',
                    timestamp: Date.now()
                });
                
                expandBtn.click();
                const toolContainer = container.querySelector('.tool-group-container');
                expect(toolContainer.classList.contains('expanded')).to.be.true;
            }
        });
    });
});
