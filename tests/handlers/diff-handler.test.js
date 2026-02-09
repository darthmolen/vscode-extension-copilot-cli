/**
 * CRITICAL Tests for Diff Button Handler
 * 
 * These tests MUST catch the Phase 0.2 bug class.
 * 
 * Phase 0.2 Bug: Only sent { available: true } instead of full diff data.
 * Result: Extension crashed with "Cannot read properties of undefined (reading '0')"
 * 
 * These tests ensure we send FULL diff data forever.
 */

import { expect } from 'chai';
import { createMockRpc } from '../helpers/jsdom-setup.js';
import { handleDiffButtonClick } from '../../src/webview/app/handlers/diff-handler.js';

describe('Diff Button Handler (CRITICAL)', () => {
	describe('handleDiffButtonClick', () => {
		it('should send FULL diff data with all required fields', () => {
			const rpc = createMockRpc();
			
			const fullData = {
				toolCallId: 'tool-123',
				beforeUri: '/tmp/before.ts',
				afterUri: '/workspace/after.ts',
				title: 'Test File'
			};
			
			handleDiffButtonClick(fullData, rpc);
			
			// Verify FULL data was sent
			const calls = rpc.getCalls();
			expect(calls).to.have.length(1);
			expect(calls[0].method).to.equal('viewDiff');
			expect(calls[0].data).to.deep.equal(fullData);
			
			// CRITICAL: These fields must be present
			expect(calls[0].data.beforeUri).to.equal('/tmp/before.ts');
			expect(calls[0].data.afterUri).to.equal('/workspace/after.ts');
			expect(calls[0].data.toolCallId).to.equal('tool-123');
			expect(calls[0].data.title).to.equal('Test File');
		});
		
		it('should send full data even when some optional fields are undefined', () => {
			const rpc = createMockRpc();
			
			const minimalData = {
				beforeUri: '/tmp/old.js',
				afterUri: '/workspace/new.js',
				toolCallId: undefined, // Optional
				title: undefined // Optional
			};
			
			handleDiffButtonClick(minimalData, rpc);
			
			const calls = rpc.getCalls();
			expect(calls[0].data.beforeUri).to.equal('/tmp/old.js');
			expect(calls[0].data.afterUri).to.equal('/workspace/new.js');
		});
		
		it('should handle nested payload format (data.data)', () => {
			const rpc = createMockRpc();
			
			// This is the defensive pattern in main.js: const data = payload.data || payload
			const nestedPayload = {
				data: {
					toolCallId: 'tool-456',
					beforeUri: '/tmp/before.js',
					afterUri: '/workspace/after.js',
					title: 'Nested Format'
				}
			};
			
			// The caller in main.js already extracts: const data = payload.data || payload
			const extractedData = nestedPayload.data || nestedPayload;
			handleDiffButtonClick(extractedData, rpc);
			
			const calls = rpc.getCalls();
			expect(calls[0].data.beforeUri).to.equal('/tmp/before.js');
			expect(calls[0].data.afterUri).to.equal('/workspace/after.js');
		});
		
		it('REGRESSION: should NOT send only boolean like Phase 0.2 bug', () => {
			const rpc = createMockRpc();
			
			const fullData = {
				toolCallId: 'tool-789',
				beforeUri: '/tmp/file.ts',
				afterUri: '/workspace/file.ts',
				title: 'Important File',
				available: true // This field should NOT be the only thing sent!
			};
			
			handleDiffButtonClick(fullData, rpc);
			
			const calls = rpc.getCalls();
			const sentData = calls[0].data;
			
			// Phase 0.2 bug sent: { available: true }
			// We must send full data:
			expect(sentData).to.have.property('beforeUri');
			expect(sentData).to.have.property('afterUri');
			expect(sentData.beforeUri).to.not.be.undefined;
			expect(sentData.afterUri).to.not.be.undefined;
			
			// If we ONLY sent { available: true }, these would be undefined
			// and the extension would crash
		});
		
		it('END-TO-END: verifies the exact data structure extension expects', () => {
			const rpc = createMockRpc();
			
			// This is what the extension MUST receive
			const expectedStructure = {
				beforeUri: '/tmp/src/utils.ts',
				afterUri: '/home/user/project/src/utils.ts',
				toolCallId: 'edit-utils-123',
				title: 'utils.ts'
			};
			
			handleDiffButtonClick(expectedStructure, rpc);
			
			const calls = rpc.getCalls();
			const sentData = calls[0].data;
			
			// Extension code does: data.beforeUri, data.afterUri, etc.
			// These MUST exist or extension crashes
			expect(sentData).to.have.all.keys('beforeUri', 'afterUri', 'toolCallId', 'title');
			expect(sentData.beforeUri).to.be.a('string');
			expect(sentData.afterUri).to.be.a('string');
		});
	});
});
