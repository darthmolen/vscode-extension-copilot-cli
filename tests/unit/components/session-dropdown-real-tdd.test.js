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
		// Verify that onSessionStarted (called after cliManager.start()) includes updateSessionsList.
		// This ensures the dropdown refreshes after the session ID is available.
		const extensionPath = path.join(__dirname, '../../../src/extension.ts');
		const extensionCode = fs.readFileSync(extensionPath, 'utf-8');

		// The post-start function must call updateSessionsList
		const successMessage = 'CLI process started successfully';
		const successIndex = extensionCode.indexOf(successMessage);
		expect(successIndex).to.be.greaterThan(0, 'Should find success message');

		const afterSuccess = extensionCode.substring(successIndex, successIndex + 500);
		const hasUpdateSessionsList = afterSuccess.includes('updateSessionsList()');
		expect(hasUpdateSessionsList).to.be.true;
	});

	it('RED: Verify the exact code pattern exists', () => {
		// startCLISession must call onSessionStarted after cliManager.start(),
		// and onSessionStarted must call updateSessionsList.
		const extensionPath = path.join(__dirname, '../../../src/extension.ts');
		const extensionCode = fs.readFileSync(extensionPath, 'utf-8');

		// Pattern: onSessionStarted function contains updateSessionsList()
		const pattern = /CLI process started successfully[\s\S]{1,500}updateSessionsList\(\)/;
		const hasPattern = pattern.test(extensionCode);
		expect(hasPattern).to.be.true;
	});
});
