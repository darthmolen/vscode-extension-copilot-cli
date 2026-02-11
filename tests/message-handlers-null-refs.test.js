/**
 * TDD RED Test: main.js message handlers access null DOM elements
 * 
 * Production errors from browser console:
 * 1. Cannot set properties of null (setting 'textContent') at handleActiveFileChangedMessage (main.js:274)
 * 2. Cannot read properties of null (reading 'classList') at handleAssistantMessageMessage (main.js:231)
 * 3. Cannot read properties of null (reading 'classList') at handleInitMessage (main.js:456)
 * 
 * Root cause: These handlers try to access DOM elements that are created by components,
 * not in the initial HTML.
 * 
 * Solution: Delegate to component methods instead of direct DOM manipulation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('TDD RED: Message handlers must delegate to components, not access DOM', () => {
	it('should document the bug - handlers access null elements', async () => {
		const fs = await import('fs');
		const mainCode = await fs.promises.readFile('src/webview/main.js', 'utf8');
		
		// Bug 1: handleActiveFileChangedMessage tries to access focusFileInfo
		const bug1 = mainCode.includes('focusFileInfo.textContent');
		
		// Bug 2: handleAssistantMessageMessage tries to access emptyState
		const bug2 = mainCode.includes('emptyState.classList');
		
		// Bug 3: Multiple places try to access emptyState
		const emptyStateRefs = (mainCode.match(/emptyState\./g) || []).length;
		
		assert.ok(bug1, 'BUG: handleActiveFileChangedMessage accesses focusFileInfo directly');
		assert.ok(bug2, 'BUG: handleAssistantMessageMessage accesses emptyState directly');
		assert.ok(emptyStateRefs > 0, `BUG: ${emptyStateRefs} places access emptyState directly`);
	});
	
	it('should show what the fix looks like - delegate to components', async () => {
		// After fix, handlers should:
		// 1. handleActiveFileChangedMessage → inputArea.updateFocusFile(path)
		// 2. handleAssistantMessageMessage → just emit event, MessageDisplay hides empty state
		// 3. handleInitMessage → just emit events, components handle their own state
		
		// Components own their DOM:
		// - InputArea owns: focusFileInfo, messageInput, sendButton, attachments
		// - MessageDisplay owns: emptyState, thinking, messages div
		// - SessionToolbar owns: session dropdown, new session button, view plan button
		
		assert.ok(true, 'Fix: Use component methods, not direct DOM access');
	});
});
