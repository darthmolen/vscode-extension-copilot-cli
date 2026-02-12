import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';

/**
 * RED TEST - Active file blank line bug
 * 
 * Bug: When no active file is set, focusFileInfo still takes up space in grid
 * Expected: Row should collapse when display:none (grid should handle this)
 */
describe('InputArea - Active File Blank Bug', () => {
	let dom, document, inputArea, eventBus;

	beforeEach(async () => {
		dom = new JSDOM(`<!DOCTYPE html><html><body><div id="input-mount"></div></body></html>`);
		document = dom.window.document;
		global.document = document;
		global.window = dom.window;

		const { InputArea } = await import('../src/webview/app/components/InputArea/InputArea.js');
		const { EventBus } = await import('../src/webview/app/state/EventBus.js');

		const inputMount = document.getElementById('input-mount');
		eventBus = new EventBus();
		inputArea = new InputArea(inputMount, eventBus);
	});

	it('should hide active file row when no file is active', () => {
		const focusFileInfo = inputArea.container.querySelector('#focusFileInfo');
		
		expect(focusFileInfo, 'Focus file element should exist').to.exist;
		expect(focusFileInfo.style.display, 'Should be hidden by default').to.equal('none');
	});

	it('should show active file when updateFocusFile is called with path', () => {
		const focusFileInfo = inputArea.container.querySelector('#focusFileInfo');
		
		inputArea.updateFocusFile('/workspace/test.js');
		
		expect(focusFileInfo.style.display, 'Should be visible').to.not.equal('none');
		expect(focusFileInfo.textContent, 'Should show filename').to.include('test.js');
	});

	it('should collapse grid row when active file is hidden (check grid template)', () => {
		const focusFileInfo = inputArea.container.querySelector('#focusFileInfo');
		
		// When hidden, display:none should make grid row collapse
		expect(focusFileInfo.style.display).to.equal('none');
		
		// Show file
		inputArea.updateFocusFile('/workspace/test.js');
		expect(focusFileInfo.style.display).to.not.equal('none');
		
		// Hide file again
		inputArea.updateFocusFile(null);
		expect(focusFileInfo.style.display).to.equal('none');
	});
});
