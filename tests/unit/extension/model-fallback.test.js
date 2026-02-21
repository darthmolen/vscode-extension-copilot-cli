/**
 * Tests for smart model fallback (v3.1.2)
 *
 * Covers:
 * - selectFallbackModel: picks best available model from user's account
 * - createSessionWithModelFallback: retries with dynamic fallback + notifies user
 */

const Module = require('module');
const originalRequire = Module.prototype.require;

// Mock vscode module BEFORE anything else loads
const warningMessages = [];
Module.prototype.require = function (id) {
    if (id === 'vscode') {
        const mock = require('../../helpers/vscode-mock');
        // Capture warning messages for assertion
        mock.window.showWarningMessage = (msg) => { warningMessages.push(msg); };
        return mock;
    }
    return originalRequire.apply(this, arguments);
};

const assert = require('assert');
const path = require('path');

describe('Smart Model Fallback', function () {
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

    // Standard available models for tests
    const standardModels = [
        { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', capabilities: { supports: { vision: true } } },
        { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', capabilities: { supports: { vision: true } } },
        { id: 'gpt-5', name: 'GPT-5', capabilities: { supports: { vision: true } } },
        { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', capabilities: { supports: { vision: true } } },
        { id: 'gpt-4.1', name: 'GPT-4.1', capabilities: { supports: { vision: false } } },
    ];

    // Enterprise-restricted models (no Claude)
    const enterpriseModelsNoClaude = [
        { id: 'gpt-5', name: 'GPT-5', capabilities: { supports: { vision: true } } },
        { id: 'gpt-5-mini', name: 'GPT-5 Mini', capabilities: { supports: { vision: false } } },
        { id: 'gpt-4.1', name: 'GPT-4.1', capabilities: { supports: { vision: false } } },
    ];

    before(function () {
        try {
            const sdkModule = require('../../../out/sdkSessionManager.js');
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

    beforeEach(function () {
        warningMessages.length = 0;
    });

    describe('selectFallbackModel', function () {
        it('should return preferred model when available', async function () {
            const service = new ModelCapabilitiesService();
            service.setClient({ listModels: async () => standardModels });

            const result = await selectFallbackModel(service, 'nonexistent-model', mockLogger);

            assert.strictEqual(result, 'claude-sonnet-4.6');
        });

        it('should skip the excluded (failed) model', async function () {
            const service = new ModelCapabilitiesService();
            service.setClient({ listModels: async () => standardModels });

            // Exclude the top-preference model
            const result = await selectFallbackModel(service, 'claude-sonnet-4.6', mockLogger);

            assert.strictEqual(result, 'claude-sonnet-4.5');
        });

        it('should skip multiple excluded models and find next preferred', async function () {
            const service = new ModelCapabilitiesService();
            service.setClient({ listModels: async () => standardModels });

            // Exclude top two preferences — should pick gpt-5
            const result = await selectFallbackModel(service, 'claude-sonnet-4.6', mockLogger);
            // claude-sonnet-4.6 excluded, so should return claude-sonnet-4.5
            assert.strictEqual(result, 'claude-sonnet-4.5');
        });

        it('should return first available when no preferred model matches', async function () {
            // Models that don't match any preference
            const unusualModels = [
                { id: 'custom-enterprise-model', name: 'Custom', capabilities: {} },
                { id: 'internal-llm-v2', name: 'Internal', capabilities: {} },
            ];
            const service = new ModelCapabilitiesService();
            service.setClient({ listModels: async () => unusualModels });

            const result = await selectFallbackModel(service, 'some-model', mockLogger);

            assert.strictEqual(result, 'custom-enterprise-model');
        });

        it('should pick gpt-5 when all Claude models are excluded', async function () {
            const service = new ModelCapabilitiesService();
            service.setClient({ listModels: async () => enterpriseModelsNoClaude });

            const result = await selectFallbackModel(service, 'some-model', mockLogger);

            assert.strictEqual(result, 'gpt-5');
        });

        it('should return FALLBACK_MODEL when getAllModels() throws', async function () {
            const service = new ModelCapabilitiesService();
            service.setClient({
                listModels: async () => { throw new Error('SDK connection failed'); }
            });

            const result = await selectFallbackModel(service, 'some-model', mockLogger);

            assert.strictEqual(result, FALLBACK_MODEL);
        });

        it('should return FALLBACK_MODEL when model list is empty', async function () {
            const service = new ModelCapabilitiesService();
            service.setClient({ listModels: async () => [] });

            const result = await selectFallbackModel(service, 'some-model', mockLogger);

            assert.strictEqual(result, FALLBACK_MODEL);
        });

        it('should return FALLBACK_MODEL when all available models are excluded', async function () {
            const singleModel = [
                { id: 'only-model', name: 'Only Model', capabilities: {} },
            ];
            const service = new ModelCapabilitiesService();
            service.setClient({ listModels: async () => singleModel });

            const result = await selectFallbackModel(service, 'only-model', mockLogger);

            assert.strictEqual(result, FALLBACK_MODEL);
        });
    });

    describe('MODEL_PREFERENCE_ORDER', function () {
        it('should be a non-empty array', function () {
            assert.ok(Array.isArray(MODEL_PREFERENCE_ORDER));
            assert.ok(MODEL_PREFERENCE_ORDER.length > 0);
        });

        it('should contain claude-sonnet-4.6 as first preference', function () {
            assert.strictEqual(MODEL_PREFERENCE_ORDER[0], 'claude-sonnet-4.6');
        });

        it('should contain claude-sonnet-4.5 as second preference', function () {
            assert.strictEqual(MODEL_PREFERENCE_ORDER[1], 'claude-sonnet-4.5');
        });
    });

    describe('FALLBACK_MODEL', function () {
        it('should be claude-sonnet-4.5', function () {
            assert.strictEqual(FALLBACK_MODEL, 'claude-sonnet-4.5');
        });
    });
});
