/**
 * Tests for JSDOM Test Utilities
 * 
 * This tests our test infrastructure to ensure it works correctly.
 * Meta-testing is important!
 */

import { expect } from 'chai';
import { createTestDOM, cleanupTestDOM, createMockRpc } from './jsdom-setup.js';

describe('JSDOM Test Utilities', () => {
	describe('createTestDOM', () => {
		let dom;
		
		afterEach(() => {
			cleanupTestDOM(dom);
		});
		
		it('should create a working DOM environment', () => {
			dom = createTestDOM('<div id="test">Hello World</div>');
			
			const element = document.getElementById('test');
			expect(element).to.exist;
			expect(element.textContent).to.equal('Hello World');
		});
		
		it('should set global.window and global.document', () => {
			dom = createTestDOM('<div id="app"></div>');
			
			expect(global.window).to.exist;
			expect(global.document).to.exist;
			expect(global.document.getElementById('app')).to.exist;
		});
		
		it('should support querySelector operations', () => {
			dom = createTestDOM(`
				<div class="container">
					<span class="item">Item 1</span>
					<span class="item">Item 2</span>
				</div>
			`);
			
			const items = document.querySelectorAll('.item');
			expect(items).to.have.length(2);
			expect(items[0].textContent).to.equal('Item 1');
			expect(items[1].textContent).to.equal('Item 2');
		});
		
		it('should support style manipulation', () => {
			dom = createTestDOM('<div id="box"></div>');
			
			const box = document.getElementById('box');
			box.style.display = 'none';
			expect(box.style.display).to.equal('none');
			
			box.style.display = 'block';
			expect(box.style.display).to.equal('block');
		});
	});
	
	describe('createMockRpc', () => {
		it('should create a working mock RPC client', () => {
			const rpc = createMockRpc();
			
			expect(rpc).to.exist;
			expect(rpc.getCalls).to.be.a('function');
			expect(rpc.newSession).to.be.a('function');
		});
		
		it('should track method calls', () => {
			const rpc = createMockRpc();
			
			rpc.newSession();
			rpc.switchSession('session-123');
			rpc.sendMessage('Hello');
			
			const calls = rpc.getCalls();
			expect(calls).to.have.length(3);
			expect(calls[0].method).to.equal('newSession');
			expect(calls[1].method).to.equal('switchSession');
			expect(calls[1].id).to.equal('session-123');
			expect(calls[2].method).to.equal('sendMessage');
			expect(calls[2].msg).to.equal('Hello');
		});
		
		it('should support getLastCall helper', () => {
			const rpc = createMockRpc();
			
			rpc.newSession();
			rpc.viewPlan();
			
			const lastCall = rpc.getLastCall();
			expect(lastCall.method).to.equal('viewPlan');
		});
		
		it('should support getCallsByMethod helper', () => {
			const rpc = createMockRpc();
			
			rpc.sendMessage('msg1');
			rpc.newSession();
			rpc.sendMessage('msg2');
			
			const sendCalls = rpc.getCallsByMethod('sendMessage');
			expect(sendCalls).to.have.length(2);
			expect(sendCalls[0].msg).to.equal('msg1');
			expect(sendCalls[1].msg).to.equal('msg2');
		});
		
		it('should support clearCalls', () => {
			const rpc = createMockRpc();
			
			rpc.newSession();
			rpc.newSession();
			expect(rpc.getCalls()).to.have.length(2);
			
			rpc.clearCalls();
			expect(rpc.getCalls()).to.have.length(0);
		});
		
		it('should track viewDiff calls with full data', () => {
			const rpc = createMockRpc();
			
			const diffData = {
				toolCallId: 'tool-123',
				beforeUri: '/tmp/before.ts',
				afterUri: '/workspace/after.ts',
				title: 'Test File'
			};
			
			rpc.viewDiff(diffData);
			
			const calls = rpc.getCalls();
			expect(calls).to.have.length(1);
			expect(calls[0].method).to.equal('viewDiff');
			expect(calls[0].data).to.deep.equal(diffData);
			expect(calls[0].data.beforeUri).to.equal('/tmp/before.ts');
		});
	});
	
	describe('cleanupTestDOM', () => {
		it('should clean up global references', () => {
			const dom = createTestDOM('<div id="test"></div>');
			
			expect(global.window).to.exist;
			expect(global.document).to.exist;
			
			cleanupTestDOM(dom);
			
			expect(global.window).to.be.undefined;
			expect(global.document).to.be.undefined;
		});
	});
});
