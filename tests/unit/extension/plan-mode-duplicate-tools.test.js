/**
 * Plan Mode Duplicate Tool Detection Test
 *
 * This test validates that plan mode doesn't create duplicate tool names.
 *
 * Root cause of the original bug:
 * - Plan mode created custom tools: bash, create, edit, task, update_work_plan
 * - When availableTools was NOT specified, SDK included ALL built-in tools
 * - Result: bash (custom) + bash (SDK) = DUPLICATE
 *
 * Fix: Tools were renamed to avoid conflicts and availableTools is now explicit.
 * This test verifies the fix remains in place by analyzing source code.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

describe('Plan Mode Duplicate Tool Detection', function () {
	let sdkManagerSource;
	let planModeToolsSource;

	before(function () {
		sdkManagerSource = fs.readFileSync(
			path.join(__dirname, '../../../src/sdkSessionManager.ts'),
			'utf-8'
		);
		planModeToolsSource = fs.readFileSync(
			path.join(__dirname, '../../../src/extension/services/planModeToolsService.ts'),
			'utf-8'
		);
	});

	// SDK built-in tools that are always available when availableTools is not specified
	const sdkBuiltinTools = [
		'bash', 'view', 'edit', 'create', 'grep', 'glob', 'task',
		'report_intent', 'web_fetch', 'fetch_copilot_cli_documentation',
		'skill', 'stop_bash', 'read_bash', 'write_bash', 'list_bash',
		'store_memory', 'update_todo'
	];

	it('should find getCustomTools method in sdkSessionManager', function () {
		assert.ok(
			sdkManagerSource.includes('getCustomTools'),
			'Could not find getCustomTools method in sdkSessionManager.ts'
		);
	});

	it('should find PlanModeToolsService with getTools method', function () {
		assert.ok(
			planModeToolsSource.includes('getTools'),
			'Could not find getTools method in planModeToolsService.ts'
		);
	});

	it('should find getAvailableToolNames method in PlanModeToolsService', function () {
		assert.ok(
			planModeToolsSource.includes('getAvailableToolNames'),
			'Could not find getAvailableToolNames in planModeToolsService.ts'
		);
	});

	it('should have renamed custom tools to avoid SDK conflicts', function () {
		// Extract tool names from getAvailableToolNames
		const toolNamesMatch = planModeToolsSource.match(
			/getAvailableToolNames\(\)[\s\S]*?return \[([\s\S]*?)\];/
		);
		assert.ok(toolNamesMatch, 'Could not find getAvailableToolNames return array');

		const toolNamesSection = toolNamesMatch[1];

		// Extract quoted tool name strings
		const toolNames = [];
		const nameRegex = /'([^']+)'/g;
		let match;
		while ((match = nameRegex.exec(toolNamesSection)) !== null) {
			toolNames.push(match[1]);
		}

		assert.ok(toolNames.length > 0, 'Should find at least one tool name');

		// Custom tools should be renamed to avoid conflicts
		// The original bug was: bash, create, edit, task conflicted with SDK
		const conflictingNames = ['bash', 'create', 'edit', 'task'];
		const foundConflicts = toolNames.filter((name) =>
			conflictingNames.includes(name)
		);

		assert.strictEqual(
			foundConflicts.length,
			0,
			'Custom tools should be renamed to avoid SDK conflicts. ' +
			'Found conflicting names: ' + foundConflicts.join(', ')
		);
	});

	it('should use renamed tool names (plan_bash_explore, create_plan_file, etc.)', function () {
		const expectedRenamedTools = [
			'plan_bash_explore',
			'create_plan_file',
			'edit_plan_file',
			'task_agent_type_explore'
		];

		for (const toolName of expectedRenamedTools) {
			assert.ok(
				planModeToolsSource.includes(toolName),
				`Expected renamed tool "${toolName}" not found in planModeToolsService.ts`
			);
		}
	});

	it('should specify availableTools in plan session creation', function () {
		// Check that plan session creation now explicitly specifies availableTools
		assert.ok(
			sdkManagerSource.includes('availableTools'),
			'Plan session should specify availableTools to prevent SDK from adding all built-in tools'
		);
	});

	it('should have no duplicate tool names between custom and available tools', function () {
		// Extract tool names from getAvailableToolNames
		const toolNamesMatch = planModeToolsSource.match(
			/getAvailableToolNames\(\)[\s\S]*?return \[([\s\S]*?)\];/
		);
		const toolNamesSection = toolNamesMatch[1];

		const toolNames = [];
		const nameRegex = /'([^']+)'/g;
		let match;
		while ((match = nameRegex.exec(toolNamesSection)) !== null) {
			toolNames.push(match[1]);
		}

		// Check for internal duplicates within the available tools list
		const seen = new Set();
		const duplicates = [];
		for (const name of toolNames) {
			if (seen.has(name)) {
				duplicates.push(name);
			}
			seen.add(name);
		}

		assert.strictEqual(
			duplicates.length,
			0,
			'Found duplicate tool names within availableTools: ' + duplicates.join(', ')
		);
	});
});
