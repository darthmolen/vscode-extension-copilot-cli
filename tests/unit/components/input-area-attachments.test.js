import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { InputArea } from '../../../src/webview/app/components/InputArea/InputArea.js';
import { EventBus } from '../../../src/webview/app/state/EventBus.js';

describe('InputArea - Attachments Preview Visibility', () => {
	let dom, container, eventBus, inputArea;

	beforeEach(() => {
		dom = new JSDOM(`<!DOCTYPE html><div id="container"></div>`);
		global.document = dom.window.document;
		global.window = dom.window;
		container = document.getElementById('container');
		eventBus = new EventBus();
		inputArea = new InputArea(container, eventBus);
	});

	it('should hide attachments preview on initial render', () => {
		const preview = container.querySelector('#attachmentsPreview');
		expect(preview).to.exist;
		expect(preview.style.display).to.equal('none');
	});

	it('should show attachments preview when attachment is added', () => {
		const mockAttachment = {
			type: 'file',
			path: '/test/file.png',
			displayName: 'file.png'
		};

		inputArea.addAttachments([mockAttachment]);

		const preview = container.querySelector('#attachmentsPreview');
		expect(preview.style.display).to.equal('flex');
	});

	it('should hide attachments preview when attachments are cleared', () => {
		const mockAttachment = {
			type: 'file',
			path: '/test/file.png',
			displayName: 'file.png'
		};

		inputArea.addAttachments([mockAttachment]);
		inputArea.clearAttachments();

		const preview = container.querySelector('#attachmentsPreview');
		expect(preview.style.display).to.equal('none');
	});
});
