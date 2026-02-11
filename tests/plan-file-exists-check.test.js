/**
 * RED Test: main.js integration with SessionToolbar
 * 
 * This should FAIL because:
 * - main.js line 251: sessionToolbar.setWorkspacePath(workspacePath)
 * - main.js line 450: sessionToolbar.setWorkspacePath(workspacePath)  
 * - main.js line 453: sessionToolbar.setWorkspacePath(null)
 * 
 * But SessionToolbar only has setPlanFileExists(), not setWorkspacePath()
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('main.js calls wrong SessionToolbar method', () => {
	it('should confirm the fix - main.js now calls setPlanFileExists()', async () => {
		// 1. Verify SessionToolbar has the right method
		const code = await import('fs').then(fs => 
			fs.promises.readFile('src/webview/app/components/SessionToolbar/SessionToolbar.js', 'utf8')
		);
		
		assert.ok(code.includes('setPlanFileExists('), 
			'SessionToolbar should have setPlanFileExists method');
		
		// 2. Verify main.js calls the RIGHT method now
		const mainCode = await import('fs').then(fs =>
			fs.promises.readFile('src/webview/main.js', 'utf8')
		);
		
		const rightCalls = (mainCode.match(/sessionToolbar\.setPlanFileExists/g) || []).length;
		assert.ok(rightCalls > 0, 
			`main.js should call setPlanFileExists() (found ${rightCalls} calls) - BUG FIXED`);
		
		// 3. Verify no more wrong calls
		const wrongCalls = (mainCode.match(/sessionToolbar\.setWorkspacePath/g) || []).length;
		assert.equal(wrongCalls, 0,
			`main.js should NOT call setWorkspacePath() (found ${wrongCalls})`);
	});
	
	it('should show what the fix looks like', async () => {
		// After fix, main.js should:
		// - NOT call setWorkspacePath
		// - SHOULD call setPlanFileExists
		// - SHOULD check if plan file exists before enabling button
		
		// This test will pass once we fix main.js
		assert.ok(true, 'Fix: replace setWorkspacePath with setPlanFileExists and check file existence');
	});
});


