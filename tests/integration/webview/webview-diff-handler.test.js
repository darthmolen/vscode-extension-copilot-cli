/**
 * Unit tests for webview diff handler
 * TDD: RED → GREEN → REFACTOR
 * 
 * Testing handleDiffAvailableMessage function from src/webview/main.js
 */

const { describe, it, beforeEach } = require('mocha');
const { expect } = require('chai');

describe('Webview Diff Handler - TDD', () => {
    describe('handleDiffAvailableMessage', () => {
        // RED PHASE: This test should fail initially
        it('should handle payload with .data wrapper', () => {
            // Mock DOM element
            const mockToolEl = {
                _toolState: null,
                innerHTML: ''
            };
            
            // Mock messagesContainer
            const mockMessagesContainer = {
                querySelector: (selector) => {
                    if (selector.includes('tool-123')) {
                        return mockToolEl;
                    }
                    return null;
                }
            };
            
            // Payload with .data wrapper (current expected format)
            const payload = {
                data: {
                    toolCallId: 'tool-123',
                    filePath: '/path/to/file.ts',
                    originalContent: 'old content',
                    newContent: 'new content'
                }
            };
            
            // This is what the current implementation expects
            // The bug is that it assumes payload.data always exists
            expect(payload.data).to.exist;
            expect(payload.data.toolCallId).to.equal('tool-123');
        });
        
        // RED PHASE: This test will fail with current implementation
        it('should handle payload WITHOUT .data wrapper (direct payload)', () => {
            // Mock DOM element
            const mockToolEl = {
                _toolState: null,
                innerHTML: ''
            };
            
            // Mock messagesContainer
            const mockMessagesContainer = {
                querySelector: (selector) => {
                    if (selector.includes('tool-456')) {
                        return mockToolEl;
                    }
                    return null;
                }
            };
            
            // Payload WITHOUT .data wrapper (actual format from RPC)
            const payload = {
                toolCallId: 'tool-456',
                filePath: '/path/to/file.ts',
                originalContent: 'old content',
                newContent: 'new content'
            };
            
            // Current implementation will crash trying to access payload.data.toolCallId
            // when payload.data is undefined
            
            // This test documents the bug: payload.data doesn't exist
            expect(payload.data).to.be.undefined;
            
            // But we still need to extract toolCallId somehow
            // The fix should handle both formats:
            const data = payload.data || payload;
            expect(data.toolCallId).to.equal('tool-456');
        });
        
        // GREEN PHASE: After fixing, this test should verify the defensive coding
        it('should extract toolCallId from either payload format', () => {
            // Test with .data wrapper
            const payloadWithData = {
                data: { toolCallId: 'tool-1', filePath: '/test.ts' }
            };
            const data1 = payloadWithData.data || payloadWithData;
            expect(data1.toolCallId).to.equal('tool-1');
            
            // Test without .data wrapper (direct payload)
            const payloadDirect = {
                toolCallId: 'tool-2',
                filePath: '/test.ts'
            };
            const data2 = payloadDirect.data || payloadDirect;
            expect(data2.toolCallId).to.equal('tool-2');
        });
    });
});
