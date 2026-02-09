/**
 * Tests for Webview Utility Functions
 */

import { expect } from 'chai';
import { escapeHtml } from '../../src/webview/app/utils/webview-utils.js';

describe('Webview Utilities', () => {
	describe('escapeHtml', () => {
		it('should escape ampersands', () => {
			expect(escapeHtml('Tom & Jerry')).to.equal('Tom &amp; Jerry');
		});
		
		it('should escape less-than signs', () => {
			expect(escapeHtml('a < b')).to.equal('a &lt; b');
		});
		
		it('should escape greater-than signs', () => {
			expect(escapeHtml('a > b')).to.equal('a &gt; b');
		});
		
		it('should escape double quotes', () => {
			expect(escapeHtml('He said "hello"')).to.equal('He said &quot;hello&quot;');
		});
		
		it('should escape single quotes', () => {
			expect(escapeHtml("It's good")).to.equal("It&#039;s good");
		});
		
		it('should escape HTML tags', () => {
			expect(escapeHtml('<script>alert("xss")</script>'))
				.to.equal('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
		});
		
		it('should escape multiple special characters', () => {
			expect(escapeHtml('<div class="test">A & B</div>'))
				.to.equal('&lt;div class=&quot;test&quot;&gt;A &amp; B&lt;/div&gt;');
		});
		
		it('should handle empty string', () => {
			expect(escapeHtml('')).to.equal('');
		});
		
		it('should handle string with no special characters', () => {
			expect(escapeHtml('Hello World')).to.equal('Hello World');
		});
	});
});
