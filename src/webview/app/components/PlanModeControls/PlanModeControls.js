/**
 * PlanModeControls - Manages plan mode button visibility and events
 * 
 * Responsibility: Plan mode buttons (enter/exit/accept/reject)
 * Parent: InputArea
 * 
 * Button States:
 * - Work Mode: [Enter Plan Mode]
 * - Plan Mode Waiting: [Exit Plan Mode]
 * - Plan Mode Ready: [Accept] [Reject]
 */
export class PlanModeControls {
  constructor(container, eventBus) {
    this.container = container;
    this.eventBus = eventBus;
    this.render();
    this.attachListeners();
  }

  render() {
    this.container.innerHTML = `
      <div class="plan-mode-controls">
        <button id="enterPlanModeBtn" class="control-btn" title="Enter Planning">💡</button>
        <button id="exitPlanModeBtn" class="control-btn" style="display: none;" title="Exit Planning">❌</button>
        <button id="acceptPlanBtn" class="control-btn" style="display: none;" title="Accept Plan">✅</button>
        <button id="rejectPlanBtn" class="control-btn" style="display: none;" title="Reject Plan">🚫</button>
      </div>
    `;

    this.enterBtn = this.container.querySelector('#enterPlanModeBtn');
    this.exitBtn = this.container.querySelector('#exitPlanModeBtn');
    this.acceptBtn = this.container.querySelector('#acceptPlanBtn');
    this.rejectBtn = this.container.querySelector('#rejectPlanBtn');
  }

  attachListeners() {
    this.enterBtn.addEventListener('click', () => {
      this.eventBus.emit('enterPlanMode');
    });

    this.exitBtn.addEventListener('click', () => {
      this.eventBus.emit('exitPlanMode');
    });

    this.acceptBtn.addEventListener('click', () => {
      this.eventBus.emit('acceptPlan');
    });

    this.rejectBtn.addEventListener('click', () => {
      this.eventBus.emit('rejectPlan');
    });
  }

  setPlanMode(planMode, planReady) {
    if (!planMode) {
      // Work mode
      this.enterBtn.style.display = '';
      this.exitBtn.style.display = 'none';
      this.acceptBtn.style.display = 'none';
      this.rejectBtn.style.display = 'none';
    } else if (planReady) {
      // Plan mode - ready (show all three: accept, reject, exit)
      this.enterBtn.style.display = 'none';
      this.exitBtn.style.display = '';  // ✅ Keep exit visible!
      this.acceptBtn.style.display = '';
      this.rejectBtn.style.display = '';
    } else {
      // Plan mode - waiting
      this.enterBtn.style.display = 'none';
      this.exitBtn.style.display = '';
      this.acceptBtn.style.display = 'none';
      this.rejectBtn.style.display = 'none';
    }
  }
}
