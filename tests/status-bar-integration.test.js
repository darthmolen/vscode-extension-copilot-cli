import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { StatusBar } from '../src/webview/app/components/StatusBar/StatusBar.js';

describe('StatusBar - Component Integration - TDD RED Phase', () => {
  let dom, container;

  beforeEach(() => {
    dom = new JSDOM(`<!DOCTYPE html><div id="container"></div>`);
    global.document = dom.window.document;
    global.window = dom.window;
    container = document.getElementById('container');
  });

  describe('Usage Metrics Display', () => {
    it('should update usage window percentage', () => {
      const statusBar = new StatusBar(container);
      
      statusBar.updateUsageWindow(45, 45000, 100000);
      
      const usageWindow = container.querySelector('#usageWindow');
      expect(usageWindow.textContent).to.include('45');
    });

    it('should update tokens used count', () => {
      const statusBar = new StatusBar(container);
      
      statusBar.updateUsageUsed(150000);
      
      const usageUsed = container.querySelector('#usageUsed');
      expect(usageUsed.textContent).to.include('150');
    });

    it('should update remaining percentage', () => {
      const statusBar = new StatusBar(container);
      
      statusBar.updateUsageRemaining(50);
      
      const usageRemaining = container.querySelector('#usageRemaining');
      expect(usageRemaining.textContent).to.include('50');
    });

    it('should handle all metrics updating together', () => {
      const statusBar = new StatusBar(container);
      
      statusBar.updateUsageWindow(35, 35000, 100000);
      statusBar.updateUsageUsed(200000);
      statusBar.updateUsageRemaining(75);
      
      const usageWindow = container.querySelector('#usageWindow');
      const usageUsed = container.querySelector('#usageUsed');
      const usageRemaining = container.querySelector('#usageRemaining');
      
      expect(usageWindow.textContent).to.include('35');
      expect(usageUsed.textContent).to.include('200');
      expect(usageRemaining.textContent).to.include('75');
    });
  });

  describe('Reasoning Display', () => {
    it('should show reasoning indicator', () => {
      const statusBar = new StatusBar(container);
      
      statusBar.showReasoning();
      
      const reasoningIndicator = container.querySelector('.reasoning-indicator');
      expect(reasoningIndicator.style.display).to.not.equal('none');
    });

    it('should hide reasoning indicator', () => {
      const statusBar = new StatusBar(container);
      
      statusBar.showReasoning();
      statusBar.hideReasoning();
      
      const reasoningIndicator = container.querySelector('.reasoning-indicator');
      expect(reasoningIndicator.style.display).to.equal('none');
    });

    it('should update reasoning text', () => {
      const statusBar = new StatusBar(container);
      
      statusBar.showReasoning();
      statusBar.setReasoningText('Analyzing code...');
      
      const reasoningText = container.querySelector('#reasoningText');
      expect(reasoningText.textContent).to.equal('Analyzing code...');
    });
  });

  describe('Reasoning Toggle Event', () => {
    it('should emit reasoningToggle event when checkbox changed to true', (done) => {
      const statusBar = new StatusBar(container);
      
      statusBar.on('reasoningToggle', (checked) => {
        expect(checked).to.be.true;
        done();
      });
      
      const checkbox = container.querySelector('#showReasoningCheckbox');
      checkbox.checked = true;
      checkbox.dispatchEvent(new window.Event('change'));
    });

    it('should emit reasoningToggle event when checkbox changed to false', (done) => {
      const statusBar = new StatusBar(container);
      
      statusBar.on('reasoningToggle', (checked) => {
        expect(checked).to.be.false;
        done();
      });
      
      const checkbox = container.querySelector('#showReasoningCheckbox');
      checkbox.checked = false;
      checkbox.dispatchEvent(new window.Event('change'));
    });

    it('should emit event with current checkbox state', (done) => {
      const statusBar = new StatusBar(container);
      
      const checkbox = container.querySelector('#showReasoningCheckbox');
      checkbox.checked = true;
      
      statusBar.on('reasoningToggle', (checked) => {
        expect(checked).to.equal(checkbox.checked);
        done();
      });
      
      checkbox.dispatchEvent(new window.Event('change'));
    });
  });
});
