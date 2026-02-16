/**
 * TDD: File snapshot capture-and-correlate pipeline
 *
 * Tests for the two-phase correlation flow (captureByPath → correlateToToolCallId)
 * that underpins the three-tier capture pipeline:
 *   Tier 1: assistant.message pre-captures by file path (primary)
 *   Tier 2: onPreToolUse hook captures as safety net
 *   Tier 3: handleToolStart fallback captures as last resort
 *
 * All tiers call captureByPath() (Phase 1), then handleToolStart correlates
 * the path-keyed snapshot to a toolCallId (Phase 2).
 *
 * This fixes the race condition where captureFileSnapshot was called
 * from handleToolStart AFTER the SDK had already started modifying files.
 */

const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Simple logger mock
class MockLogger {
    debug() {}
    info() {}
    warn() {}
    error() {}
    static getInstance() { return new MockLogger(); }
}

// Inlined FileSnapshotService — mirrors src/extension/services/fileSnapshotService.ts
// Includes new captureByPath / correlateToToolCallId for two-phase hook correlation.
class FileSnapshotService {
    constructor() {
        this.logger = MockLogger.getInstance();
        this.fileSnapshots = new Map();
        this.pendingByPath = new Map();
        this._nextId = 0;
        this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-cli-snapshots-'));
    }

    captureFileSnapshot(toolCallId, toolName, args) {
        if (toolName !== 'edit' && toolName !== 'create') {
            return null;
        }

        const filePath = args?.path;
        if (!filePath) {
            return null;
        }

        const existedBefore = fs.existsSync(filePath);
        let tempFilePath = '';

        if (existedBefore) {
            const fileName = path.basename(filePath);
            const timestamp = Date.now();
            tempFilePath = path.join(this.tempDir, `${toolCallId}-${timestamp}-${fileName}`);
            fs.copyFileSync(filePath, tempFilePath);
        } else {
            const fileName = path.basename(filePath);
            const timestamp = Date.now();
            tempFilePath = path.join(this.tempDir, `${toolCallId}-${timestamp}-${fileName}-empty`);
            fs.writeFileSync(tempFilePath, '', 'utf8');
        }

        const snapshot = {
            toolCallId,
            originalPath: filePath,
            tempFilePath,
            existedBefore
        };

        this.fileSnapshots.set(toolCallId, snapshot);
        return snapshot;
    }

    captureByPath(toolName, filePath) {
        if (toolName !== 'edit' && toolName !== 'create') {
            return;
        }

        // Clean up previous pending snapshot for this path before creating new one
        const previous = this.pendingByPath.get(filePath);
        if (previous && previous.tempFilePath && fs.existsSync(previous.tempFilePath)) {
            fs.unlinkSync(previous.tempFilePath);
        }

        const existedBefore = fs.existsSync(filePath);
        const fileName = path.basename(filePath);
        const uniqueId = `${Date.now()}-${this._nextId++}`;
        let tempFilePath;

        if (existedBefore) {
            tempFilePath = path.join(this.tempDir, `pending-${uniqueId}-${fileName}`);
            fs.copyFileSync(filePath, tempFilePath);
        } else {
            tempFilePath = path.join(this.tempDir, `pending-${uniqueId}-${fileName}-empty`);
            fs.writeFileSync(tempFilePath, '', 'utf8');
        }

        this.pendingByPath.set(filePath, {
            originalPath: filePath,
            tempFilePath,
            existedBefore
        });
    }

    getPendingByPath(filePath) {
        return this.pendingByPath.get(filePath) || null;
    }

    correlateToToolCallId(filePath, toolCallId) {
        const pending = this.pendingByPath.get(filePath);
        if (pending) {
            this.fileSnapshots.set(toolCallId, {
                toolCallId,
                ...pending
            });
            this.pendingByPath.delete(filePath);
        }
    }

    getSnapshot(toolCallId) {
        return this.fileSnapshots.get(toolCallId) || null;
    }

    cleanupSnapshot(toolCallId) {
        const snapshot = this.fileSnapshots.get(toolCallId);
        if (snapshot) {
            try {
                if (snapshot.tempFilePath && fs.existsSync(snapshot.tempFilePath)) {
                    fs.unlinkSync(snapshot.tempFilePath);
                }
                this.fileSnapshots.delete(toolCallId);
            } catch (error) {
                // Ignore cleanup errors
            }
        }
    }

    cleanupAllSnapshots() {
        for (const [toolCallId] of this.fileSnapshots) {
            this.cleanupSnapshot(toolCallId);
        }
    }

    dispose() {
        this.cleanupAllSnapshots();
        try {
            if (fs.existsSync(this.tempDir)) {
                fs.rmSync(this.tempDir, { recursive: true, force: true });
            }
        } catch (error) {
            // Ignore
        }
    }
}

describe('FileSnapshotService - Hooks-Based Capture (TDD)', () => {
    let service;
    let testDir;

    beforeEach(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-hooks-test-'));
        service = new FileSnapshotService();
    });

    afterEach(() => {
        if (service) {
            service.dispose();
        }
        if (testDir && fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    describe('captureByPath — Phase 1 (onPreToolUse hook)', () => {
        it('should capture snapshot of existing file keyed by file path', () => {
            const testFile = path.join(testDir, 'target.ts');
            const originalContent = 'const x = 1;\n';
            fs.writeFileSync(testFile, originalContent);

            service.captureByPath('edit', testFile);

            // Snapshot should exist in pending state (keyed by path, not toolCallId)
            const pending = service.getPendingByPath(testFile);
            expect(pending).to.exist;
            expect(pending.originalPath).to.equal(testFile);
            expect(fs.existsSync(pending.tempFilePath)).to.be.true;
            expect(fs.readFileSync(pending.tempFilePath, 'utf8')).to.equal(originalContent);
        });

        it('should create empty snapshot for non-existent file (create tool)', () => {
            const testFile = path.join(testDir, 'brand-new.ts');

            service.captureByPath('create', testFile);

            const pending = service.getPendingByPath(testFile);
            expect(pending).to.exist;
            expect(pending.originalPath).to.equal(testFile);
            expect(pending.existedBefore).to.be.false;
            expect(fs.existsSync(pending.tempFilePath)).to.be.true;
            expect(fs.readFileSync(pending.tempFilePath, 'utf8')).to.equal('');
        });

        it('should ignore non-edit/create tools', () => {
            const testFile = path.join(testDir, 'target.ts');
            fs.writeFileSync(testFile, 'content');

            service.captureByPath('bash', testFile);

            const pending = service.getPendingByPath(testFile);
            expect(pending).to.be.null;
        });

        it('should overwrite previous pending snapshot for same file path', () => {
            const testFile = path.join(testDir, 'target.ts');
            fs.writeFileSync(testFile, 'version 1');

            service.captureByPath('edit', testFile);

            // Modify the file to simulate first edit completing
            fs.writeFileSync(testFile, 'version 2');

            // Second captureByPath for same file should overwrite
            service.captureByPath('edit', testFile);

            const pending = service.getPendingByPath(testFile);
            expect(pending).to.exist;
            // Should have captured version 2 (latest content at time of second capture)
            expect(fs.readFileSync(pending.tempFilePath, 'utf8')).to.equal('version 2');
        });
    });

    describe('correlateToToolCallId — Phase 2 (tool.execution_start)', () => {
        it('should re-key pending snapshot from path to toolCallId', () => {
            const testFile = path.join(testDir, 'target.ts');
            const originalContent = 'const y = 2;\n';
            fs.writeFileSync(testFile, originalContent);

            // Phase 1: hook captures by path
            service.captureByPath('edit', testFile);

            // Phase 2: execution_start correlates to toolCallId
            service.correlateToToolCallId(testFile, 'call-abc-123');

            // Pending should be cleared
            const pending = service.getPendingByPath(testFile);
            expect(pending).to.be.null;

            // Should now be retrievable by toolCallId
            const snapshot = service.getSnapshot('call-abc-123');
            expect(snapshot).to.exist;
            expect(snapshot.originalPath).to.equal(testFile);
            expect(fs.readFileSync(snapshot.tempFilePath, 'utf8')).to.equal(originalContent);
        });

        it('should do nothing if no pending snapshot for path', () => {
            service.correlateToToolCallId('/nonexistent/file.ts', 'call-xyz');

            const snapshot = service.getSnapshot('call-xyz');
            expect(snapshot).to.be.null;
        });

        it('should handle correlation after file has been modified (the race condition fix)', () => {
            const testFile = path.join(testDir, 'race-target.ts');
            const originalContent = 'function foo() { return 1; }\n';
            fs.writeFileSync(testFile, originalContent);

            // Phase 1: hook fires BEFORE SDK modifies file
            service.captureByPath('edit', testFile);

            // SDK modifies the file (simulating the race condition)
            fs.writeFileSync(testFile, 'function foo() { return 42; }\n');

            // Phase 2: execution_start fires AFTER modification has begun
            service.correlateToToolCallId(testFile, 'call-race-fix');

            // The snapshot should contain the ORIGINAL content (captured before modification)
            const snapshot = service.getSnapshot('call-race-fix');
            expect(snapshot).to.exist;
            expect(fs.readFileSync(snapshot.tempFilePath, 'utf8')).to.equal(originalContent);
        });
    });

    describe('end-to-end two-phase flow', () => {
        it('should work for full hook → correlation → getSnapshot pipeline', () => {
            const testFile = path.join(testDir, 'pipeline.ts');
            const originalContent = 'export class Foo {}\n';
            fs.writeFileSync(testFile, originalContent);

            // 1. onPreToolUse hook fires
            service.captureByPath('edit', testFile);

            // 2. SDK modifies the file
            fs.writeFileSync(testFile, 'export class Foo { bar() {} }\n');

            // 3. tool.execution_start fires with toolCallId
            service.correlateToToolCallId(testFile, 'tool-call-999');

            // 4. handleToolComplete retrieves by toolCallId
            const snapshot = service.getSnapshot('tool-call-999');
            expect(snapshot).to.exist;
            expect(snapshot.originalPath).to.equal(testFile);
            expect(snapshot.existedBefore).to.be.true;

            // 5. Diff should show original content
            const snapshotContent = fs.readFileSync(snapshot.tempFilePath, 'utf8');
            expect(snapshotContent).to.equal(originalContent);

            // 6. Cleanup works via toolCallId
            service.cleanupSnapshot('tool-call-999');
            expect(service.getSnapshot('tool-call-999')).to.be.null;
        });

        it('should handle multiple files edited in same turn', () => {
            const file1 = path.join(testDir, 'file1.ts');
            const file2 = path.join(testDir, 'file2.ts');
            fs.writeFileSync(file1, 'file 1 original');
            fs.writeFileSync(file2, 'file 2 original');

            // Hooks fire for both files
            service.captureByPath('edit', file1);
            service.captureByPath('edit', file2);

            // SDK modifies both
            fs.writeFileSync(file1, 'file 1 modified');
            fs.writeFileSync(file2, 'file 2 modified');

            // Correlate each to its own toolCallId
            service.correlateToToolCallId(file1, 'call-1');
            service.correlateToToolCallId(file2, 'call-2');

            // Each snapshot has correct original content
            const snap1 = service.getSnapshot('call-1');
            const snap2 = service.getSnapshot('call-2');
            expect(fs.readFileSync(snap1.tempFilePath, 'utf8')).to.equal('file 1 original');
            expect(fs.readFileSync(snap2.tempFilePath, 'utf8')).to.equal('file 2 original');
        });
    });
});
