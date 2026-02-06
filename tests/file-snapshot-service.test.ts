/**
 * Unit tests for FileSnapshotService
 * TDD: RED -> GREEN -> REFACTOR
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock Logger before importing FileSnapshotService
class MockLogger {
    debug(msg: string) { }
    info(msg: string) { }
    warn(msg: string) { }
    error(msg: string) { }
    static getInstance() { return new MockLogger(); }
}

// Inject mock Logger
import * as Module from 'module';
const originalRequire = Module.prototype.require;
(Module.prototype.require as any) = function(id: string) {
    if (id === '../src/logger' || id.endsWith('/logger')) {
        return { Logger: MockLogger };
    }
    return originalRequire.apply(this, arguments as any);
};

// Now import the service
import { FileSnapshotService } from '../src/fileSnapshotService';

describe('FileSnapshotService - TDD', () => {
    let service: FileSnapshotService;
    let testDir: string;
    
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
        it('RED: should capture snapshot of existing file', () => {
            const testFile = path.join(testDir, 'test.txt');
            const originalContent = 'original content';
            fs.writeFileSync(testFile, originalContent);
            
            const toolCallId = 'tool-123';
            const snapshot = service.captureFileSnapshot(toolCallId, 'edit', { path: testFile });
            
            expect(snapshot).to.exist;
            expect(snapshot!.originalPath).to.equal(testFile);
            expect(snapshot!.tempFilePath).to.be.a('string');
            expect(fs.existsSync(snapshot!.tempFilePath)).to.be.true;
            expect(fs.readFileSync(snapshot!.tempFilePath, 'utf8')).to.equal(originalContent);
        });
        
        it('RED: should handle new file (no original content)', () => {
            const testFile = path.join(testDir, 'newfile.txt');
            const toolCallId = 'tool-124';
            const snapshot = service.captureFileSnapshot(toolCallId, 'create', { path: testFile });
            
            expect(snapshot).to.exist;
            expect(snapshot!.originalPath).to.equal(testFile);
            expect(snapshot!.existedBefore).to.be.false;
        });
        
        it('RED: should only capture for edit and create tools', () => {
            const testFile = path.join(testDir, 'test.txt');
            fs.writeFileSync(testFile, 'content');
            
            const snapshot = service.captureFileSnapshot('tool-125', 'bash', { path: testFile });
            expect(snapshot).to.be.null;
        });
        
        it('RED: should return null if no path in arguments', () => {
            const snapshot = service.captureFileSnapshot('tool-126', 'edit', {});
            expect(snapshot).to.be.null;
        });
    });
    
    describe('cleanupSnapshot', () => {
        it('RED: should cleanup specific snapshot', () => {
            const testFile = path.join(testDir, 'test.txt');
            fs.writeFileSync(testFile, 'content');
            
            const toolCallId = 'tool-127';
            const snapshot = service.captureFileSnapshot(toolCallId, 'edit', { path: testFile });
            const tempFile = snapshot!.tempFilePath;
            
            expect(fs.existsSync(tempFile)).to.be.true;
            service.cleanupSnapshot(toolCallId);
            expect(fs.existsSync(tempFile)).to.be.false;
        });
        
        it('RED: should handle cleanup of non-existent snapshot gracefully', () => {
            expect(() => service.cleanupSnapshot('nonexistent')).to.not.throw();
        });
    });
    
    describe('getSnapshot', () => {
        it('RED: should return snapshot by toolCallId', () => {
            const testFile = path.join(testDir, 'test.txt');
            fs.writeFileSync(testFile, 'content');
            
            const toolCallId = 'tool-128';
            service.captureFileSnapshot(toolCallId, 'edit', { path: testFile });
            
            const snapshot = service.getSnapshot(toolCallId);
            expect(snapshot).to.exist;
            expect(snapshot!.originalPath).to.equal(testFile);
        });
        
        it('RED: should return null for non-existent snapshot', () => {
            const snapshot = service.getSnapshot('nonexistent');
            expect(snapshot).to.be.null;
        });
    });
});
