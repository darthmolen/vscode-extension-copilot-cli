/**
 * Tests for smart model fallback (v3.1.2)
 *
 * Covers:
 * - selectFallbackModel: picks best available model from user's account
 * - MODEL_PREFERENCE_ORDER and FALLBACK_MODEL constants
 */

const Module = require('module');
const originalRequire = Module.prototype.require;

// Mock vscode module BEFORE anything else loads
Module.prototype.require = function (id) {
    if (id === 'vscode') {
        return require('../../helpers/vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

const assert = require('assert');
const path = require('path');

describe('Smart Model Fallback', function () {
    let resolveActiveModel;
    this.timeout(10000);

    let selectFallbackModel, MODEL_PREFERENCE_ORDER, FALLBACK_MODEL;
    let ModelCapabilitiesService;

    // Mock logger
    const mockLogger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {}
    };

    // Standard available models for tests (current-gen, includes auto)
    const standardModels = [
        { id: 'auto', name: 'Auto', capabilities: { supports: {} } },
        { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', capabilities: { supports: { vision: true } } },
        { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', capabilities: { supports: { vision: true } } },
        { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', capabilities: { supports: { vision: true } } },
        { id: 'gpt-5.4', name: 'GPT-5.4', capabilities: { supports: { vision: true } } },
        { id: 'gpt-5-mini', name: 'GPT-5 Mini', capabilities: { supports: { vision: false } } },
    ];

    // Account with no Claude / auto models
    const enterpriseModelsNoClaude = [
        { id: 'gpt-5.4', name: 'GPT-5.4', capabilities: { supports: { vision: true } } },
        { id: 'gpt-5-mini', name: 'GPT-5 Mini', capabilities: { supports: { vision: false } } },
    ];

    before(function () {
        try {
            const sdkModule = require('../../../out/sdkSessionManager.js');
            resolveActiveModel = sdkModule.resolveActiveModel;
            selectFallbackModel = sdkModule.selectFallbackModel;
            MODEL_PREFERENCE_ORDER = sdkModule.MODEL_PREFERENCE_ORDER;
            FALLBACK_MODEL = sdkModule.FALLBACK_MODEL;

            const capsModule = require('../../../out/extension/services/modelCapabilitiesService.js');
            ModelCapabilitiesService = capsModule.ModelCapabilitiesService;
        } catch (e) {
            console.log('Module not yet compiled, skipping:', e.message);
            this.skip();
        }
    });

    describe('selectFallbackModel', function () {
        it('should return auto (top preference) when available', async function () {
            const service = new ModelCapabilitiesService();
            service.setClient({ listModels: async () => standardModels });

            const result = await selectFallbackModel(service, new Set(['nonexistent-model']), mockLogger);

            assert.strictEqual(result, 'auto');
        });

        it('should skip a single excluded model', async function () {
            const service = new ModelCapabilitiesService();
            service.setClient({ listModels: async () => standardModels });

            // Exclude auto — next preference present is claude-sonnet-5
            const result = await selectFallbackModel(service, new Set(['auto']), mockLogger);

            assert.strictEqual(result, 'claude-sonnet-5');
        });

        it('should skip multiple excluded models and pick next preferred', async function () {
            const service = new ModelCapabilitiesService();
            service.setClient({ listModels: async () => standardModels });

            // Exclude top two preferences — should pick claude-sonnet-4.6
            const result = await selectFallbackModel(
                service,
                new Set(['auto', 'claude-sonnet-5']),
                mockLogger
            );

            assert.strictEqual(result, 'claude-sonnet-4.6');
        });

        it('should return first available when no preferred model matches', async function () {
            const unusualModels = [
                { id: 'custom-enterprise-model', name: 'Custom', capabilities: {} },
                { id: 'internal-llm-v2', name: 'Internal', capabilities: {} },
            ];
            const service = new ModelCapabilitiesService();
            service.setClient({ listModels: async () => unusualModels });

            const result = await selectFallbackModel(service, new Set(['some-model']), mockLogger);

            assert.strictEqual(result, 'custom-enterprise-model');
        });

        it('should pick gpt-5.4 when no Claude/auto models are available', async function () {
            const service = new ModelCapabilitiesService();
            service.setClient({ listModels: async () => enterpriseModelsNoClaude });

            const result = await selectFallbackModel(service, new Set(['some-model']), mockLogger);

            assert.strictEqual(result, 'gpt-5.4');
        });

        it('should return FALLBACK_MODEL when getAllModels() throws', async function () {
            const service = new ModelCapabilitiesService();
            service.setClient({
                listModels: async () => { throw new Error('SDK connection failed'); }
            });

            const result = await selectFallbackModel(service, new Set(['some-model']), mockLogger);

            assert.strictEqual(result, FALLBACK_MODEL);
        });

        it('should return FALLBACK_MODEL when model list is empty', async function () {
            const service = new ModelCapabilitiesService();
            service.setClient({ listModels: async () => [] });

            const result = await selectFallbackModel(service, new Set(['some-model']), mockLogger);

            assert.strictEqual(result, FALLBACK_MODEL);
        });

        it('should return FALLBACK_MODEL when all available models are excluded', async function () {
            const singleModel = [
                { id: 'only-model', name: 'Only Model', capabilities: {} },
            ];
            const service = new ModelCapabilitiesService();
            service.setClient({ listModels: async () => singleModel });

            const result = await selectFallbackModel(service, new Set(['only-model']), mockLogger);

            assert.strictEqual(result, FALLBACK_MODEL);
        });

        it('should work with empty exclusion set', async function () {
            const service = new ModelCapabilitiesService();
            service.setClient({ listModels: async () => standardModels });

            const result = await selectFallbackModel(service, new Set(), mockLogger);

            assert.strictEqual(result, 'auto');
        });
    });

    describe('resolveActiveModel', function () {
        // The UI used to report `copilotCLI.model` -- the *setting* -- while the
        // session ran on something else. When the requested model does not exist,
        // the fallback quietly switches to `auto` and the CLI says so in
        // `session.start.selectedModel`, but nothing adopted it. So the dropdown
        // kept showing a dead model, and vision/attachment limits were computed
        // against a model that is not in the catalogue at all.
        //
        // The CLI's reported model is the authority. This decides when to adopt it.

        it('adopts the reported model when it differs from what is tracked', function () {
            assert.strictEqual(resolveActiveModel('auto', 'claude-sonnet-4.6'), 'auto');
        });

        it('returns null when the reported model already matches', function () {
            assert.strictEqual(resolveActiveModel('auto', 'auto'), null);
        });

        it('adopts the reported model when nothing is tracked yet', function () {
            assert.strictEqual(resolveActiveModel('claude-sonnet-5', null), 'claude-sonnet-5');
        });

        it('ignores a missing reported model rather than clearing what is tracked', function () {
            // Older CLIs, and some events, carry no selectedModel. Losing the
            // tracked model there would blank the dropdown for no reason.
            assert.strictEqual(resolveActiveModel(undefined, 'claude-sonnet-5'), null);
            assert.strictEqual(resolveActiveModel(null, 'claude-sonnet-5'), null);
            assert.strictEqual(resolveActiveModel('', 'claude-sonnet-5'), null);
        });

        it('ignores a non-string reported model', function () {
            assert.strictEqual(resolveActiveModel(42, 'claude-sonnet-5'), null);
            assert.strictEqual(resolveActiveModel({ id: 'x' }, 'claude-sonnet-5'), null);
        });
    });

    describe('MODEL_PREFERENCE_ORDER', function () {
        it('should be a non-empty array', function () {
            assert.ok(Array.isArray(MODEL_PREFERENCE_ORDER));
            assert.ok(MODEL_PREFERENCE_ORDER.length > 0);
        });

        it('should contain auto as first preference', function () {
            assert.strictEqual(MODEL_PREFERENCE_ORDER[0], 'auto');
        });

        it('should contain claude-sonnet-5 as second preference', function () {
            assert.strictEqual(MODEL_PREFERENCE_ORDER[1], 'claude-sonnet-5');
        });
    });

    describe('FALLBACK_MODEL', function () {
        it('should be auto', function () {
            assert.strictEqual(FALLBACK_MODEL, 'auto');
        });
    });
});
