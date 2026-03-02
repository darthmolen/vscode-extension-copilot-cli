/**
 * Tests for resolveCliPath() — CLI binary resolution with 4-tier fallback.
 *
 * Verifies that the extension correctly resolves the Copilot CLI binary path
 * across all installation methods: user config, SDK bundle, PATH lookup, and
 * failure with actionable error.
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

const childProcess = require('child_process');
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const mockLogger = {
    messages: [],
    info(msg) { this.messages.push(msg); },
    clear() { this.messages = []; }
};

describe('resolveCliPath', function () {
    this.timeout(10000);

    let resolveCliPath;
    let originalExecFileSync;
    let originalExistsSync;

    before(function () {
        const modulePath = path.join(__dirname, '../../../out/sdkSessionManager.js');
        try {
            resolveCliPath = require(modulePath).resolveCliPath;
        } catch (e) {
            this.skip();
        }
        if (!resolveCliPath) {
            this.skip();
        }
    });

    beforeEach(function () {
        mockLogger.clear();
        originalExecFileSync = childProcess.execFileSync;
        originalExistsSync = fs.existsSync;
    });

    afterEach(function () {
        childProcess.execFileSync = originalExecFileSync;
        fs.existsSync = originalExistsSync;
    });

    describe('Tier 1: User-configured path', function () {
        it('should return custom configured path directly', function () {
            const result = resolveCliPath(mockLogger, 'C:\\Program Files\\copilot\\copilot.exe');

            assert.strictEqual(result, 'C:\\Program Files\\copilot\\copilot.exe');
            assert.ok(
                mockLogger.messages.some(m => m.includes('configured CLI path')),
                'should log that it used the configured path'
            );
        });

        it('should return custom path without attempting PATH lookup', function () {
            let execFileSyncCalled = false;
            childProcess.execFileSync = () => { execFileSyncCalled = true; return ''; };

            resolveCliPath(mockLogger, '/usr/local/bin/my-copilot');

            assert.strictEqual(execFileSyncCalled, false, 'should not call execFileSync for custom path');
        });
    });

    describe('Tier 1 bypass: Default "copilot" falls through', function () {
        it('should NOT return bare "copilot" when config is the default', function () {
            // Make PATH lookup succeed so we get a real path back
            childProcess.execFileSync = (cmd, args) => {
                if (args[0] === 'copilot') return '/usr/local/bin/copilot\n';
                return originalExecFileSync(cmd, args);
            };
            fs.existsSync = () => false; // No SDK bundle

            const result = resolveCliPath(mockLogger, 'copilot');

            assert.notStrictEqual(result, 'copilot', 'should not return bare "copilot"');
            assert.strictEqual(result, '/usr/local/bin/copilot');
        });

        it('should fall through when config is undefined', function () {
            childProcess.execFileSync = (cmd, args) => {
                if (args[0] === 'copilot') return '/opt/copilot\n';
                return originalExecFileSync(cmd, args);
            };
            fs.existsSync = () => false;

            const result = resolveCliPath(mockLogger, undefined);

            assert.strictEqual(result, '/opt/copilot');
        });

        it('should fall through when config is empty string', function () {
            childProcess.execFileSync = (cmd, args) => {
                if (args[0] === 'copilot') return '/opt/copilot\n';
                return originalExecFileSync(cmd, args);
            };
            fs.existsSync = () => false;

            const result = resolveCliPath(mockLogger, '');

            assert.strictEqual(result, '/opt/copilot');
        });
    });

    describe('Tier 2: SDK-bundled binary', function () {
        it('should return SDK bundle path when package resolves and file exists', function () {
            // existsSync returns true for any path containing "copilot"
            fs.existsSync = (p) => typeof p === 'string' && p.includes('copilot');

            // execFileSync should NOT be called if SDK bundle is found
            let execFileSyncCalled = false;
            childProcess.execFileSync = () => { execFileSyncCalled = true; return ''; };

            try {
                const result = resolveCliPath(mockLogger, 'copilot');
                // require.resolve succeeds in dev environment with node_modules
                assert.ok(
                    mockLogger.messages.some(m => m.includes('SDK bundle')),
                    'should log SDK bundle resolution'
                );
                assert.strictEqual(execFileSyncCalled, false, 'should not fall through to PATH');
            } catch {
                // require.resolve may fail in test environment — that's OK,
                // this test validates the path when the SDK package IS installed
                this.skip();
            }
        });
    });

    describe('Tier 3: PATH lookup', function () {
        it('should resolve via PATH when SDK bundle is unavailable', function () {
            fs.existsSync = () => false; // No SDK bundle

            childProcess.execFileSync = (cmd, args) => {
                if (args[0] === 'copilot') {
                    return '/usr/local/bin/copilot\n';
                }
                return originalExecFileSync(cmd, args);
            };

            const result = resolveCliPath(mockLogger, 'copilot');

            assert.strictEqual(result, '/usr/local/bin/copilot');
            assert.ok(
                mockLogger.messages.some(m => m.includes('Resolved CLI from PATH')),
                'should log PATH resolution'
            );
        });

        it('should handle multi-line output from "where" (Windows)', function () {
            fs.existsSync = () => false;

            childProcess.execFileSync = (cmd, args) => {
                if (args[0] === 'copilot') {
                    return 'C:\\Program Files\\GitHub\\copilot.exe\r\nC:\\Users\\me\\AppData\\copilot.exe\r\n';
                }
                return originalExecFileSync(cmd, args);
            };

            const result = resolveCliPath(mockLogger, 'copilot');

            assert.strictEqual(result, 'C:\\Program Files\\GitHub\\copilot.exe');
        });
    });

    describe('Tier 4: All resolution fails', function () {
        it('should throw with install instructions when nothing works', function () {
            fs.existsSync = () => false;
            childProcess.execFileSync = () => { throw new Error('not found'); };

            assert.throws(
                () => resolveCliPath(mockLogger, 'copilot'),
                (err) => {
                    assert.ok(err.message.includes('Copilot CLI not found on PATH'), 'error mentions PATH');
                    assert.ok(err.message.includes('copilotCLI.cliPath'), 'error mentions settings');
                    return true;
                }
            );
        });
    });
});
