/**
 * Install the `vscode` mock for one test file, and take it back out again.
 *
 * Roughly ten test files patch `Module.prototype.require` at module scope and
 * never restore it. That is one of the four documented globals leaking across
 * files in this suite, and the reason a green run proves so little
 * (`planning/backlog/test-suite-flake-cross-file-global-pollution.md`).
 *
 * This does the same job with a matching teardown: it captures whatever `require`
 * was in force at install time and puts exactly that back, so it composes with
 * the files that do leak instead of fighting them. Modules loaded under the mock
 * are evicted from the cache on the way out, so a later file requiring the same
 * compiled module gets a fresh one rather than one bound to a fake vscode.
 *
 * Usage:
 *
 *     const mock = installVscodeMock();
 *     before(() => mock.install());
 *     after(() => mock.restore());
 */

const Module = require('module');
const path = require('path');

function installVscodeMock(vscodeStub) {
    const stub = vscodeStub ?? require('./vscode-mock');
    let previousRequire = null;
    const loadedUnderMock = new Set();

    return {
        /** The stub itself, so a test can read what the code called. */
        vscode: stub,

        install() {
            previousRequire = Module.prototype.require;
            Module.prototype.require = function (id) {
                if (id === 'vscode') {
                    return stub;
                }
                const resolved = previousRequire.apply(this, arguments);
                try {
                    loadedUnderMock.add(Module._resolveFilename(id, this));
                } catch {
                    // Builtins and anything unresolvable are not ours to evict.
                }
                return resolved;
            };
        },

        restore() {
            if (previousRequire) {
                Module.prototype.require = previousRequire;
                previousRequire = null;
            }
            for (const filename of loadedUnderMock) {
                // Only our own compiled output — evicting node_modules would make
                // every later file pay to reload them.
                if (filename.includes(`${path.sep}out${path.sep}`)) {
                    delete require.cache[filename];
                }
            }
            loadedUnderMock.clear();
        }
    };
}

module.exports = { installVscodeMock };
