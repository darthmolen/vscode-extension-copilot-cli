/**
 * Tool Group Toggle Handler
 * 
 * Handles expanding/contracting tool groups when they overflow the max height.
 */

/**
 * Toggle tool group expanded/collapsed state
 * @param {boolean} currentExpanded - Current expanded state
 * @param {HTMLElement} container - Tool group container element
 * @param {HTMLElement} toggle - Toggle button element
 * @param {HTMLElement} element - Parent tool group element
 * @returns {boolean} New expanded state
 */
export function handleToolGroupToggle(currentExpanded, container, toggle, element) {
	const newExpanded = !currentExpanded;
	
	if (newExpanded) {
		container.classList.add('expanded');
		toggle.textContent = 'Contract';
	} else {
		container.classList.remove('expanded');
		const hiddenCount = element.querySelectorAll('.tool-execution').length - Math.floor(200 / 70);
		toggle.textContent = `Expand (${Math.max(1, hiddenCount)} more)`;
	}
	
	return newExpanded;
}
