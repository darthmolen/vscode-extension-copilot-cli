/**
 * ActiveFileDisplay - Displays the currently active file path
 * 
 * Responsibility: Show/hide active file information
 * Parent: InputArea
 */
export class ActiveFileDisplay {
  constructor(container, eventBus) {
    this.container = container;
    this.eventBus = eventBus;
    this.render();
  }

  render() {
    this.container.innerHTML = `
      <div class="active-file-display" style="display: none;">
        <span class="file-icon">📄</span>
        <span class="file-path"></span>
      </div>
    `;

    this.displayEl = this.container.querySelector('.active-file-display');
    this.pathEl = this.container.querySelector('.file-path');
  }

  setFile(filePath) {
    if (!filePath) {
      this.clear();
      return;
    }

    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    this.pathEl.textContent = fileName;
    this.pathEl.title = filePath;
    this.displayEl.style.display = '';
  }

  clear() {
    this.pathEl.textContent = '';
    this.displayEl.style.display = 'none';
  }
}
