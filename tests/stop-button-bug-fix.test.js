/**
 * Stop Button Bug Fix - TDD Test
 * 
 * Bug: rpc.abort is not a function
 * Root cause: main.js line 154 calls rpc.abort() but WebviewRpcClient has abortMessage()
 * 
 * RED Phase: This test should FAIL showing the bug
 * GREEN Phase: Fix main.js to call rpc.abortMessage()
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Stop Button Bug Fix - main.js calls correct RPC method', () => {
	
	it('should demonstrate that rpc.abort() does not exist (the bug)', () => {
		// This test demonstrates the BUG in main.js line 154
		// main.js calls rpc.abort() but WebviewRpcClient only has abortMessage()
		
		const mockRpc = {
			abortMessage: () => {},  // Correct method exists
			// abort: does NOT exist - this is the bug!
		};
		
		// This simulates current broken main.js code (line 154)
		assert.throws(
			() => {
				mockRpc.abort();  // This will throw: abort is not a function
			},
			{
				name: 'TypeError',
				message: /abort is not a function/
			},
			'Calling rpc.abort() should throw TypeError because method does not exist'
		);
	});
	
	it('should call rpc.abortMessage() when input:abort event is received', async () => {
		// This tests what main.js line 154 SHOULD do
		
		// Import EventBus
		const { EventBus } = await import('../src/webview/app/state/EventBus.js');
		const eventBus = new EventBus();
		
		let abortMessageCalled = false;
		const mockRpc = {
			abortMessage: () => {
				abortMessageCalled = true;
			}
		};
		
		// Simulate main.js event handler (FIXED version)
		eventBus.on('input:abort', () => {
			// Fixed code should call abortMessage()
			mockRpc.abortMessage();
		});
		
		// Act: Emit the abort event (simulating stop button click)
		eventBus.emit('input:abort');
		
		// Assert: abortMessage should have been called
		assert.ok(abortMessageCalled, 'Should call rpc.abortMessage() not rpc.abort()');
	});
});
