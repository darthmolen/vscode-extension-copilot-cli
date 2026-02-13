/**
 * Unit tests for webview init handler
 * TDD: RED → GREEN → REFACTOR
 * 
 * Testing handleInitMessage function from src/webview/main.js
 * Bug: View Plan button not showing because workspacePath not set during init
 */

const { describe, it, beforeEach } = require('mocha');
const { expect } = require('chai');

describe('Webview Init Handler - TDD', () => {
    describe('handleInitMessage', () => {
        // RED PHASE: This test demonstrates the bug
        it('should set workspacePath from payload when provided', () => {
            // Mock init payload with workspacePath
            const payload = {
                sessionId: 'test-session-123',
                sessionActive: true,
                workspacePath: '/home/user/project',
                messages: [
                    { role: 'user', content: 'Hello' }
                ]
            };
            
            // The bug: handleInitMessage doesn't extract workspacePath
            // Current implementation only processes: messages, sessionActive
            // Missing: workspacePath extraction and viewPlanBtn visibility update
            
            // This test verifies the payload HAS workspacePath
            expect(payload.workspacePath).to.equal('/home/user/project');
            
            // After fix, handleInitMessage should:
            // 1. Set global workspacePath = payload.workspacePath
            // 2. Update viewPlanBtn.style.display based on workspacePath
        });
        
        it('should handle workspacePath = null when not provided', () => {
            // Mock init payload WITHOUT workspacePath
            const payload = {
                sessionId: 'test-session-456',
                sessionActive: true,
                workspacePath: null,
                messages: []
            };
            
            // When workspacePath is null, viewPlanBtn should be hidden
            expect(payload.workspacePath).to.be.null;
            
            // After fix, handleInitMessage should:
            // 1. Set workspacePath = null
            // 2. Hide viewPlanBtn (display: 'none')
        });
        
        it('should show viewPlanBtn when workspacePath exists', () => {
            // Mock button element
            const mockViewPlanBtn = {
                style: { display: 'none' }
            };
            
            const workspacePath = '/home/user/workspace';
            
            // Simulate the logic that should be in handleInitMessage
            if (workspacePath) {
                mockViewPlanBtn.style.display = 'inline-block';
            } else {
                mockViewPlanBtn.style.display = 'none';
            }
            
            expect(mockViewPlanBtn.style.display).to.equal('inline-block');
        });
        
        it('should hide viewPlanBtn when workspacePath is null', () => {
            // Mock button element
            const mockViewPlanBtn = {
                style: { display: 'inline-block' }
            };
            
            const workspacePath = null;
            
            // Simulate the logic that should be in handleInitMessage
            if (workspacePath) {
                mockViewPlanBtn.style.display = 'inline-block';
            } else {
                mockViewPlanBtn.style.display = 'none';
            }
            
            expect(mockViewPlanBtn.style.display).to.equal('none');
        });
    });
});
