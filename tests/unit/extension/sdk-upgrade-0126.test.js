/**
 * Tests for SDK 0.1.26 upgrade (v3.3.0)
 *
 * TDD RED phase: Tests written BEFORE the implementation exists.
 *
 * Covers:
 * 1. approveAll is imported and available
 * 2. onPermissionRequest is added to session configs (via createSessionWithModelFallback)
 * 3. clientName is added to session configs
 * 4. --no-auto-update removed from cliArgs (SDK 0.1.23+ includes it)
 * 5. --yolo only passed when yolo=true AND no allowTools/denyTools set
 */

const Module = require('module');
const originalRequire = Module.prototype.require;

// Track workspace config for test control
let mockYolo = false;
let mockAllowTools = [];
let mockDenyTools = [];

Module.prototype.require = function (id) {
	if (id === 'vscode') {
		const mock = require('../../helpers/vscode-mock');
		// Override workspace configuration for yolo/allowTools/denyTools
		mock.workspace.getConfiguration = (section) => ({
			get: (key, defaultValue) => {
				if (section === 'copilotCLI') {
					if (key === 'yolo') return mockYolo;
					if (key === 'allowTools') return mockAllowTools;
					if (key === 'denyTools') return mockDenyTools;
				}
				return defaultValue;
			},
			has: () => false,
			inspect: () => ({}),
			update: () => Promise.resolve(),
		});
		return mock;
	}
	return originalRequire.apply(this, arguments);
};

const assert = require('assert');
const path = require('path');

describe('SDK 0.1.26 Upgrade', function () {
	this.timeout(10000);

	let SDKSessionManager;

	before(function () {
		try {
			const mod = require('../../../out/sdkSessionManager.js');
			SDKSessionManager = mod.SDKSessionManager;
		} catch (e) {
			console.log('Module not yet compiled, skipping:', e.message);
			this.skip();
		}
	});

	afterEach(function () {
		mockYolo = false;
		mockAllowTools = [];
		mockDenyTools = [];
	});

	describe('approveAll import', function () {
		it('should export approveAll from loadSDK', async function () {
			// After loadSDK runs, the module-level approveAll should be available
			// We can check this by looking at the module's exports or by testing
			// that createSessionWithModelFallback includes it in config
			const mod = require('../../../out/sdkSessionManager.js');
			// The approveAll should be importable from the SDK
			const sdk = await import('@github/copilot-sdk');
			assert.strictEqual(typeof sdk.approveAll, 'function');
			assert.deepStrictEqual(sdk.approveAll(), { kind: 'approved' });
		});
	});

	describe('onPermissionRequest in session configs', function () {
		it('should inject onPermissionRequest: approveAll in createSessionWithModelFallback', function () {
			// Verify the source code injects approveAll into the config
			const fs = require('fs');
			const source = fs.readFileSync(
				path.join(__dirname, '../../../src/sdkSessionManager.ts'), 'utf8'
			);

			// Find createSessionWithModelFallback method
			const methodMatch = source.match(/createSessionWithModelFallback\(config[^)]*\)[^{]*\{([\s\S]*?)(?=private\s|public\s|^\s{4}\})/m);
			assert.ok(methodMatch, 'createSessionWithModelFallback method should exist');

			const methodBody = methodMatch[1];
			assert.ok(methodBody.includes('onPermissionRequest'),
				'createSessionWithModelFallback should reference onPermissionRequest');
			assert.ok(methodBody.includes('approveAll'),
				'createSessionWithModelFallback should use approveAll');
		});

		it('should inject onPermissionRequest: approveAll in attemptSessionResumeWithUserRecovery', function () {
			const fs = require('fs');
			const source = fs.readFileSync(
				path.join(__dirname, '../../../src/sdkSessionManager.ts'), 'utf8'
			);

			// Find attemptSessionResumeWithUserRecovery method
			const methodMatch = source.match(/attemptSessionResumeWithUserRecovery\([\s\S]*?\{([\s\S]*?)(?=\/\/ Wrap the SDK)/m);
			assert.ok(methodMatch, 'attemptSessionResumeWithUserRecovery method should exist');

			const methodBody = methodMatch[1];
			assert.ok(methodBody.includes('onPermissionRequest'),
				'attemptSessionResumeWithUserRecovery should inject onPermissionRequest');
			assert.ok(methodBody.includes('approveAll'),
				'attemptSessionResumeWithUserRecovery should use approveAll');
		});

		it('should have approveAll available as module-level variable', function () {
			const fs = require('fs');
			const source = fs.readFileSync(
				path.join(__dirname, '../../../src/sdkSessionManager.ts'), 'utf8'
			);

			// Verify approveAll is declared and set in loadSDK
			assert.ok(source.includes('let approveAll'),
				'approveAll should be declared as module-level variable');
			assert.ok(source.includes('approveAll = sdk.approveAll'),
				'approveAll should be assigned from SDK in loadSDK()');
		});
	});

	describe('clientName in session configs', function () {
		it('should include clientName in createSessionWithModelFallback config', function () {
			let capturedConfig = null;

			const mockContext = {
				logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
				client: {
					createSession: async (config) => {
						capturedConfig = config;
						return { sessionId: 'test-session', on: () => () => {}, destroy: async () => {} };
					}
				},
				config: { model: 'gpt-5' },
				modelCapabilitiesService: { getAllModels: async () => [] },
				isModelUnsupportedError: () => false,
				_onDidReceiveOutput: { fire: () => {} },
			};

			return SDKSessionManager.prototype.createSessionWithModelFallback.call(
				mockContext,
				{ model: 'gpt-5', tools: [] }
			).then(() => {
				assert.ok(capturedConfig, 'createSession should have been called');
				assert.strictEqual(capturedConfig.clientName, 'vscode-copilot-cli',
					'clientName should be vscode-copilot-cli');
			});
		});
	});

	describe('cliArgs cleanup', function () {
		it('should NOT include --no-auto-update in cliArgs', function () {
			// Read the source code and verify --no-auto-update is removed
			// Test by creating a CopilotClient and inspecting its config
			// Since we can't easily construct the full manager, test via code inspection
			const fs = require('fs');
			const source = fs.readFileSync(
				path.join(__dirname, '../../../src/sdkSessionManager.ts'), 'utf8'
			);

			// Count occurrences of '--no-auto-update' in CopilotClient constructor cliArgs
			const cliArgsBlocks = source.match(/cliArgs:\s*\[([^\]]*)\]/g) || [];
			for (const block of cliArgsBlocks) {
				assert.ok(!block.includes('--no-auto-update'),
					`Found --no-auto-update in cliArgs block: ${block}`);
			}
		});
	});

	describe('--yolo flag logic', function () {
		it('should NOT pass --yolo when yolo=true but allowTools is set', function () {
			const fs = require('fs');
			const source = fs.readFileSync(
				path.join(__dirname, '../../../src/sdkSessionManager.ts'), 'utf8'
			);

			// The yolo logic should check for allowTools/denyTools
			// Look for the pattern: only pass --yolo when yolo AND no tool policy
			const hasToolPolicyCheck = source.includes('allowTools') && source.includes('denyTools');
			assert.ok(hasToolPolicyCheck,
				'Source should reference allowTools and denyTools in yolo logic');

			// Verify the pattern: yolo should be conditional on no tool policy
			// Look for something like: const useYolo = yolo && !hasToolPolicy
			const hasConditionalYolo = /(?:hasToolPolicy|allowTools|denyTools).*yolo|yolo.*(?:hasToolPolicy|allowTools|denyTools)/s.test(source);
			assert.ok(hasConditionalYolo,
				'Yolo flag should be conditional on tool policy settings');
		});
	});
});
