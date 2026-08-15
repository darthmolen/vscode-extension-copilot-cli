/**
 * Run a callback in a process where the `vscode` module does not exist.
 *
 * Tests that prove a module has no runtime dependency on VS Code must make
 * `require('vscode')` THROW, not return a mock — a mock still resolves, so a
 * module with a hard dependency would pass. Anything reaching for `vscode`
 * inside the callback gets `MODULE_NOT_FOUND`.
 *
 * Compiled modules under `out/` are evicted from the require cache first, so
 * the module graph reloads under the ban, and re-evicted afterwards so later
 * tests get a clean copy.
 *
 * Handles async callbacks: a naive `try/finally` would restore `require` as
 * soon as an async `fn` RETURNS ITS PROMISE — before its body had run — which
 * silently lifts the ban for everything after the first `await`.
 *
 * @template T
 * @param {() => T | Promise<T>} fn
 * @returns {T | Promise<T>} whatever `fn` returns; a promise if `fn` is async
 */
function withoutVscode(fn) {
    const path = require('path');
    const Module = require('module');
    const originalRequire = Module.prototype.require;

    const cleared = [];
    for (const key of Object.keys(require.cache)) {
        if (key.includes(`${path.sep}out${path.sep}`)) {
            cleared.push(key);
            delete require.cache[key];
        }
    }

    Module.prototype.require = function (id) {
        if (id === 'vscode') {
            const err = new Error("Cannot find module 'vscode'");
            err.code = 'MODULE_NOT_FOUND';
            throw err;
        }
        return originalRequire.apply(this, arguments);
    };

    const restore = () => {
        Module.prototype.require = originalRequire;
        for (const key of cleared) {
            delete require.cache[key];
        }
    };

    let result;
    try {
        result = fn();
    } catch (e) {
        restore();
        throw e;
    }

    // Async callback: hold the ban until the promise settles.
    if (result && typeof result.then === 'function') {
        return result.then(
            value => { restore(); return value; },
            error => { restore(); throw error; }
        );
    }

    restore();
    return result;
}

module.exports = { withoutVscode };
