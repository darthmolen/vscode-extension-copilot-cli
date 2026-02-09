/**
 * Tests for Message Input Handlers
 */

import { expect } from 'chai';
import { createTestDOM, cleanupTestDOM, createMockRpc } from '../helpers/jsdom-setup.js';
import {
	handleInputChange,
	handleAttachFiles,
	handleSendButtonClick,
	handleMessageKeydown
} from '../../src/webview/app/handlers/message-handlers.js';

describe('Message Input Handlers', () => {
	let dom;
	
	afterEach(() => {
		cleanupTestDOM(dom);
	});
	
	describe('handleInputChange', () => {
		it('should auto-resize textarea based on scroll height', () => {
			dom = createTestDOM('<textarea id="input"></textarea>');
			const textarea = document.getElementById('input');
			
			// Set scrollHeight (JSDOM doesn't auto-calculate, so we mock it)
			Object.defineProperty(textarea, 'scrollHeight', {
				writable: true,
				value: 100
			});
			
			handleInputChange(textarea);
			
			// Should reset height to auto first, then set to scrollHeight
			expect(textarea.style.height).to.equal('100px');
		});
	});
	
	describe('handleAttachFiles', () => {
		it('should call rpc.pickFiles', () => {
			const rpc = createMockRpc();
			handleAttachFiles(rpc);
			
			const calls = rpc.getCalls();
			expect(calls).to.have.length(1);
			expect(calls[0].method).to.equal('selectFiles');
		});
	});
	
	describe('handleSendButtonClick', () => {
		it('should abort message when thinking', () => {
			const rpc = createMockRpc();
			let sendCalled = false;
			const sendCallback = () => { sendCalled = true; };
			
			handleSendButtonClick(true, rpc, sendCallback);
			
			// Should abort, not send
			const calls = rpc.getCalls();
			expect(calls).to.have.length(1);
			expect(calls[0].method).to.equal('abortMessage');
			expect(sendCalled).to.equal(false);
		});
		
		it('should send message when not thinking', () => {
			const rpc = createMockRpc();
			let sendCalled = false;
			const sendCallback = () => { sendCalled = true; };
			
			handleSendButtonClick(false, rpc, sendCallback);
			
			// Should send, not abort
			expect(rpc.getCalls()).to.have.length(0); // No RPC call
			expect(sendCalled).to.equal(true);
		});
	});
	
	describe('handleMessageKeydown', () => {
		it('should send message on Enter without shift', () => {
			let sendCalled = false;
			let navigateCalled = false;
			
			const event = {
				key: 'Enter',
				shiftKey: false,
				preventDefault: () => {}
			};
			
			const sendCallback = () => { sendCalled = true; };
			const navigateCallback = () => { navigateCalled = true; };
			
			handleMessageKeydown(event, sendCallback, navigateCallback);
			
			expect(sendCalled).to.equal(true);
			expect(navigateCalled).to.equal(false);
		});
		
		it('should NOT send message on Shift+Enter', () => {
			let sendCalled = false;
			
			const event = {
				key: 'Enter',
				shiftKey: true,
				preventDefault: () => {}
			};
			
			const sendCallback = () => { sendCalled = true; };
			const navigateCallback = () => {};
			
			handleMessageKeydown(event, sendCallback, navigateCallback);
			
			expect(sendCalled).to.equal(false);
		});
		
		it('should navigate up on ArrowUp', () => {
			let direction = null;
			
			const event = {
				key: 'ArrowUp',
				shiftKey: false,
				preventDefault: () => {}
			};
			
			const sendCallback = () => {};
			const navigateCallback = (dir) => { direction = dir; };
			
			handleMessageKeydown(event, sendCallback, navigateCallback);
			
			expect(direction).to.equal('up');
		});
		
		it('should navigate down on ArrowDown', () => {
			let direction = null;
			
			const event = {
				key: 'ArrowDown',
				shiftKey: false,
				preventDefault: () => {}
			};
			
			const sendCallback = () => {};
			const navigateCallback = (dir) => { direction = dir; };
			
			handleMessageKeydown(event, sendCallback, navigateCallback);
			
			expect(direction).to.equal('down');
		});
		
		it('should do nothing on other keys', () => {
			let sendCalled = false;
			let navigateCalled = false;
			
			const event = {
				key: 'a',
				shiftKey: false,
				preventDefault: () => {}
			};
			
			const sendCallback = () => { sendCalled = true; };
			const navigateCallback = () => { navigateCalled = true; };
			
			handleMessageKeydown(event, sendCallback, navigateCallback);
			
			expect(sendCalled).to.equal(false);
			expect(navigateCalled).to.equal(false);
		});
	});
});
