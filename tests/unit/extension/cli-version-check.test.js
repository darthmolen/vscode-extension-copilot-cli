/**
 * Tests for CLI version parsing (v3.1.2)
 *
 * Verifies that parseCliVersion() extracts version strings from
 * various `copilot --version` output formats.
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

describe('CLI Version Check', function () {
    this.timeout(10000);

    let sdkSessionManagerModule;

    before(function () {
        // Load the compiled module
        const modulePath = path.join(__dirname, '../../../out/sdkSessionManager.js');
        try {
            sdkSessionManagerModule = require(modulePath);
        } catch (e) {
            this.skip();
        }
    });

    describe('parseCliVersion', function () {
        it('should parse "copilot version 0.0.403" format', function () {
            const version = sdkSessionManagerModule.parseCliVersion('copilot version 0.0.403');
            assert.strictEqual(version, '0.0.403');
        });

        it('should parse bare "0.0.403" format', function () {
            const version = sdkSessionManagerModule.parseCliVersion('0.0.403');
            assert.strictEqual(version, '0.0.403');
        });

        it('should parse version with trailing newline', function () {
            const version = sdkSessionManagerModule.parseCliVersion('copilot version 0.0.414\n');
            assert.strictEqual(version, '0.0.414');
        });

        it('should return null for unparseable output', function () {
            const version = sdkSessionManagerModule.parseCliVersion('not a version string');
            assert.strictEqual(version, null);
        });

        it('should return null for empty string', function () {
            const version = sdkSessionManagerModule.parseCliVersion('');
            assert.strictEqual(version, null);
        });
    });
});
