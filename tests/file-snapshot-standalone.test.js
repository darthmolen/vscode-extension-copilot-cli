/**
 * Standalone FileSnapshot tests
 * TDD: Testing core logic without vscode dependencies
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

// Inline FileSnapshotService logic (extracted for testing)
class FileSnapshotService {
    constructor() {
        this.logger = MockLogger.getInstance();
        this.fileSnapshots = new Map();
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
                fs.rmdirSync(this.tempDir);
            }
        } catch (error) {
            // Ignore
        }
    }
}

describe('FileSnapshotService - TDD', () => {
    let service;
    let testDir;
    
    beforeEach(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-test-'));
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
    
    describe('captureFileSnapshot', () => {
        it('should capture snapshot of existing file', () => {
            const testFile = path.join(testDir, 'test.txt');
            const originalContent = 'original content';
            fs.writeFileSync(testFile, originalContent);
            
            const snapshot = service.captureFileSnapshot('tool-123', 'edit', { path: testFile });
            
            expect(snapshot).to.exist;
            expect(snapshot.originalPath).to.equal(testFile);
            expect(snapshot.tempFilePath).to.be.a('string');
            expect(fs.existsSync(snapshot.tempFilePath)).to.be.true;
            expect(fs.readFileSync(snapshot.tempFilePath, 'utf8')).to.equal(originalContent);
        });
        
        it('should handle new file (no original)', () => {
            const testFile = path.join(testDir, 'newfile.txt');
            const snapshot = service.captureFileSnapshot('tool-124', 'create', { path: testFile });
            
            expect(snapshot).to.exist;
            expect(snapshot.originalPath).to.equal(testFile);
            expect(snapshot.existedBefore).to.be.false;
        });
        
        it('should only capture for edit and create tools', () => {
            const testFile = path.join(testDir, 'test.txt');
            fs.writeFileSync(testFile, 'content');
            
            const snapshot = service.captureFileSnapshot('tool-125', 'bash', { path: testFile });
            expect(snapshot).to.be.null;
        });
        
        it('should return null if no path in arguments', () => {
            const snapshot = service.captureFileSnapshot('tool-126', 'edit', {});
            expect(snapshot).to.be.null;
        });
    });
    
    describe('cleanupSnapshot', () => {
        it('should cleanup specific snapshot', () => {
            const testFile = path.join(testDir, 'test.txt');
            fs.writeFileSync(testFile, 'content');
            
            const snapshot = service.captureFileSnapshot('tool-127', 'edit', { path: testFile });
            const tempFile = snapshot.tempFilePath;
            
            expect(fs.existsSync(tempFile)).to.be.true;
            service.cleanupSnapshot('tool-127');
            expect(fs.existsSync(tempFile)).to.be.false;
        });
        
        it('should handle cleanup of non-existent snapshot', () => {
            expect(() => service.cleanupSnapshot('nonexistent')).to.not.throw();
        });
    });
    
    describe('getSnapshot', () => {
        it('should return snapshot by toolCallId', () => {
            const testFile = path.join(testDir, 'test.txt');
            fs.writeFileSync(testFile, 'content');
            
            service.captureFileSnapshot('tool-128', 'edit', { path: testFile });
            const snapshot = service.getSnapshot('tool-128');
            
            expect(snapshot).to.exist;
            expect(snapshot.originalPath).to.equal(testFile);
        });
        
        it('should return null for non-existent snapshot', () => {
            const snapshot = service.getSnapshot('nonexistent');
            expect(snapshot).to.be.null;
        });
    });
});
