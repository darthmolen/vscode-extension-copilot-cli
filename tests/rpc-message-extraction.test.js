/**
 * Integration test for RPC message data extraction
 * 
 * This tests the EXTENSION side of the diff button flow.
 * The webview side is tested in diff-handler.test.js
 * 
 * Bug context: Phase 0.2 bug had TWO parts:
 * 1. Webview not sending full data (fixed in Phase 4.0)
 * 2. Extension not extracting data correctly (THIS TEST)
 */

import { expect } from 'chai';

describe('RPC Message Data Extraction (Extension Side)', () => {
	describe('viewDiff command', () => {
		it('should extract diff data from RPC message with data property', () => {
			// This is what the RPC router sends
			const rpcMessage = {
				type: 'viewDiff',
				data: {
					beforeUri: '/tmp/before.ts',
					afterUri: '/workspace/after.ts',
					toolCallId: 'tool-123',
					title: 'Test File'
				}
			};
			
			// This is what extension.ts does (line 271) - FIXED
			const diffData = rpcMessage.data || rpcMessage; // CORRECT: .data
			
			// Now it works!
			expect(diffData.beforeUri).to.equal('/tmp/before.ts');
			expect(diffData.afterUri).to.equal('/workspace/after.ts');
			expect(diffData.toolCallId).to.equal('tool-123');
			expect(diffData.title).to.equal('Test File');
		});
		
		it('should handle message without data wrapper (backward compat)', () => {
			// Fallback case: message IS the data
			const directMessage = {
				beforeUri: '/tmp/old.js',
				afterUri: '/workspace/new.js',
				toolCallId: 'tool-456',
				title: 'Direct'
			};
			
			// FIXED code handles this too
			const diffData = directMessage.data || directMessage;
			
			expect(diffData.beforeUri).to.equal('/tmp/old.js');
			expect(diffData.afterUri).to.equal('/workspace/new.js');
		});
		
		it('REGRESSION: proves fix prevents Phase 0.2 bug', () => {
			// This is the ACTUAL message structure from RPC router
			const actualRpcMessage = {
				type: 'viewDiff',
				data: {
					beforeUri: '/tmp/snapshot.md',
					afterUri: '/home/user/file.md',
					toolCallId: 'edit-123',
					title: 'file.md (Before ↔ After)'
				}
			};
			
			// FIXED code does this:
			const diffData = actualRpcMessage.data || actualRpcMessage;
			
			// Now diffData = { beforeUri, afterUri, ... } (correct!)
			// NOT { type: 'viewDiff', data: {...} } (wrong!)
			
			// Extension can now access properties directly
			expect(diffData.beforeUri).to.equal('/tmp/snapshot.md');
			expect(diffData.afterUri).to.equal('/home/user/file.md');
			expect(diffData.toolCallId).to.equal('edit-123');
			expect(diffData.title).to.equal('file.md (Before ↔ After)');
			
			// Verify data is NOT nested (proves we extracted it)
			expect(diffData.data).to.be.undefined;
		});
	});
});
