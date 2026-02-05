/**
 * Common VS Code API mock for tests
 * 
 * This module provides a standardized mock of the vscode API that all tests can use.
 * Ensures consistency and reduces duplication across test files.
 */

function createVSCodeMock() {
    return {
        workspace: {
            workspaceFolders: [{ uri: { fsPath: __dirname } }],
            getConfiguration: (section) => ({
                get: (key, defaultValue) => {
                    if (section === 'copilotCLI') {
                        const config = {
                            'cliPath': 'copilot',
                            'yoloMode': false,
                            'yolo': false,
                            'model': 'gpt-4o',
                            'includeActiveFile': false,
                            'resolveFileReferences': false
                        };
                        return config[key] !== undefined ? config[key] : defaultValue;
                    }
                    return defaultValue;
                }
            })
        },
        EventEmitter: class EventEmitter {
            constructor() {
                this.listeners = [];
                this.event = this.event.bind(this);
            }
            fire(data) {
                this.listeners.forEach(listener => listener(data));
            }
            event(listener) {
                this.listeners.push(listener);
                return { dispose: () => {
                    const index = this.listeners.indexOf(listener);
                    if (index > -1) this.listeners.splice(index, 1);
                }};
            }
            dispose() {
                this.listeners = [];
            }
        },
        Uri: {
            file: (path) => ({ fsPath: path })
        },
        window: {
            showInformationMessage: () => {},
            showErrorMessage: () => {},
            showWarningMessage: () => {},
            createOutputChannel: () => ({
                appendLine: () => {},
                show: () => {},
                dispose: () => {}
            }),
            // CRITICAL: SDKSessionManager needs this
            onDidChangeActiveTextEditor: (callback) => ({
                dispose: () => {}
            }),
            activeTextEditor: undefined
        },
        commands: {
            registerCommand: () => ({ dispose: () => {} }),
            executeCommand: () => Promise.resolve()
        }
    };
}

module.exports = { createVSCodeMock };
