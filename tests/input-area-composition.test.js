import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { InputArea } from '../src/webview/app/components/InputArea/InputArea.js';
import { EventBus } from '../src/webview/app/state/EventBus.js';

describe('InputArea - Component Composition - TDD RED Phase', () => {
  let dom, container, eventBus;

  beforeEach(() => {
    dom = new JSDOM(`<!DOCTYPE html><div id="container"></div>`);
    global.document = dom.window.document;
    global.window = dom.window;
    container = document.getElementById('container');
    eventBus = new EventBus();
  });

  describe('Child Component Creation', () => {
    it('should create all child components on initialization', () => {
      const inputArea = new InputArea(container, eventBus);
      
      expect(inputArea.activeFileDisplay).to.exist;
      expect(inputArea.statusBar).to.exist;
      expect(inputArea.planModeControls).to.exist;
    });

    it('should create ActiveFileDisplay instance', () => {
      const inputArea = new InputArea(container, eventBus);
      
      expect(inputArea.activeFileDisplay.constructor.name).to.equal('ActiveFileDisplay');
    });

    it('should create StatusBar instance', () => {
      const inputArea = new InputArea(container, eventBus);
      
      expect(inputArea.statusBar.constructor.name).to.equal('StatusBar');
    });

    it('should create PlanModeControls instance', () => {
      const inputArea = new InputArea(container, eventBus);
      
      expect(inputArea.planModeControls.constructor.name).to.equal('PlanModeControls');
    });
  });

  describe('Mount Point Structure', () => {
    it('should create mount points for all child components', () => {
      const inputArea = new InputArea(container, eventBus);
      
      const activeFileMount = container.querySelector('#active-file-mount');
      const metricsMount = container.querySelector('#metrics-mount');
      const planControlsMount = container.querySelector('#plan-controls-mount');
      
      expect(activeFileMount).to.exist;
      expect(metricsMount).to.exist;
      expect(planControlsMount).to.exist;
    });

    it('should mount ActiveFileDisplay in correct container', () => {
      const inputArea = new InputArea(container, eventBus);
      
      const activeFileMount = container.querySelector('#active-file-mount');
      const activeFileDisplay = activeFileMount.querySelector('.active-file-display');
      
      expect(activeFileDisplay).to.exist;
    });

    it('should mount StatusBar in correct container', () => {
      const inputArea = new InputArea(container, eventBus);
      
      const metricsMount = container.querySelector('#metrics-mount');
      const statusBar = metricsMount.querySelector('.status-bar');
      
      expect(statusBar).to.exist;
    });

    it('should mount PlanModeControls in correct container', () => {
      const inputArea = new InputArea(container, eventBus);
      
      const planControlsMount = container.querySelector('#plan-controls-mount');
      const planControls = planControlsMount.querySelector('.plan-mode-controls');
      
      expect(planControls).to.exist;
    });
  });

  describe('Delegation to Child Components', () => {
    it('should forward setPlanMode to PlanModeControls child', () => {
      const inputArea = new InputArea(container, eventBus);
      
      inputArea.setPlanMode(true, false);
      
      // Verify PlanModeControls shows Exit button
      const exitBtn = container.querySelector('#exitPlanModeBtn');
      expect(exitBtn).to.exist;
      expect(exitBtn.style.display).to.not.equal('none');
    });

    it('should forward setFile to ActiveFileDisplay child', () => {
      const inputArea = new InputArea(container, eventBus);
      
      inputArea.setFile('/workspace/src/test.ts');
      
      // Verify ActiveFileDisplay shows file
      const filePath = container.querySelector('.file-path');
      expect(filePath.textContent).to.equal('/workspace/src/test.ts');
    });

    it('should forward updateUsageWindow to StatusBar child', () => {
      const inputArea = new InputArea(container, eventBus);
      
      inputArea.updateUsageWindow(50, 50000, 100000);
      
      // Verify StatusBar shows metrics
      const usageWindow = container.querySelector('#usageWindow');
      expect(usageWindow.textContent).to.include('50');
    });
  });

  describe('Event Coordination', () => {
    it('should emit reasoningToggle events from InputArea checkbox', (done) => {
      const inputArea = new InputArea(container, eventBus);
      
      eventBus.on('reasoning:toggle', (checked) => {
        expect(checked).to.be.true;
        done();
      });
      
      const reasoningCheckbox = container.querySelector('#reasoningCheckbox');
      reasoningCheckbox.checked = true;
      reasoningCheckbox.dispatchEvent(new window.Event('change'));
    });

    it('should relay enterPlanMode events from PlanModeControls', (done) => {
      const inputArea = new InputArea(container, eventBus);
      inputArea.setPlanMode(false, false);
      
      eventBus.on('enterPlanMode', () => {
        done();
      });
      
      const enterBtn = container.querySelector('#enterPlanModeBtn');
      enterBtn.click();
    });

    it('should relay acceptPlan events from PlanModeControls', (done) => {
      const inputArea = new InputArea(container, eventBus);
      inputArea.setPlanMode(true, true);
      
      eventBus.on('acceptPlan', () => {
        done();
      });
      
      const acceptBtn = container.querySelector('#acceptPlanBtn');
      acceptBtn.click();
    });
  });
});
