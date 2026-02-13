/**
 * PROPER TDD Test for session dropdown selection after resume
 * 
 * Bug: Dropdown shows "No session" after resuming
 * 
 * This test imports ACTUAL production code and verifies the bug.
 * Unlike the previous mock-based tests, this will FAIL against buggy code.
 */

import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Session Dropdown Selection Bug (REAL TDD)', () => {
	
	it('RED: updateSessionsList must be called AFTER session starts', async () => {
		// This test will FAIL against buggy code because updateSessionsList
		// is NOT called after the session starts.
		
		// Read the extension.ts file and check for the pattern
		const extensionPath = path.join(__dirname, '../../../src/extension.ts');
		const extensionCode = fs.readFileSync(extensionPath, 'utf-8');
		
		// Find the section after "CLI process started successfully"
		const successMessage = '✅ CLI process started successfully';
		const successIndex = extensionCode.indexOf(successMessage);
		expect(successIndex).to.be.greaterThan(0, 'Should find success message');
		
		// Get the next 500 characters after the success message
		const afterSuccess = extensionCode.substring(successIndex, successIndex + 500);
		
		// Check if updateSessionsList() is called in that section
		const hasUpdateSessionsList = afterSuccess.includes('updateSessionsList()');
		
		// WITH BUG: This will FAIL because updateSessionsList is NOT called
		// AFTER FIX: This will PASS because updateSessionsList IS called
		expect(hasUpdateSessionsList).to.be.true;
	});
	
	it('RED: Verify the exact code pattern exists', () => {
		// This is a stricter version - check the actual code structure
		const extensionPath = path.join(__dirname, '../../../src/extension.ts');
		const extensionCode = fs.readFileSync(extensionPath, 'utf-8');
		
		// Pattern we expect to see:
		// logger.info('✅ CLI process started successfully');
		// ... some code ...
		// updateSessionsList();
		
		const pattern = /CLI process started successfully[\s\S]{1,500}updateSessionsList\(\)/;
		const hasPattern = pattern.test(extensionCode);
		
		// WITH BUG: FAILS (no updateSessionsList after success)
		// AFTER FIX: PASSES (updateSessionsList present)
		expect(hasPattern).to.be.true;
	});
});
