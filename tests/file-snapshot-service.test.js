/**
 * Unit tests for FileSnapshotService
 * 
 * TDD RED-GREEN-REFACTOR
 * Step 1: RED - Write failing tests (this file)
 * Step 2: GREEN - Implement minimal code to pass
 * Step 3: REFACTOR - Clean up while keeping tests green
 */

const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const os = require('os');

// This will fail until we create the service - that's expected for RED phase
const { FileSnapshotService } = require('../dist/extension.js');

describe('FileSnapshotService', () => {
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
            
            const toolCallId = 'tool-123';
            const snapshot = service.captureFileSnapshot(toolCallId, 'edit', { path: testFile });
            
            expect(snapshot).to.exist;
            expect(snapshot.originalPath).to.equal(testFile);
            expect(snapshot.tempFilePath).to.be.a('string');
            expect(fs.existsSync(snapshot.tempFilePath)).to.be.true;
            expect(fs.readFileSync(snapshot.tempFilePath, 'utf8')).to.equal(originalContent);
        });
        
        it('should handle new file (no original content)', () => {
            const testFile = path.join(testDir, 'newfile.txt');
            const toolCallId = 'tool-124';
            const snapshot = service.captureFileSnapshot(toolCallId, 'create', { path: testFile });
            
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
            
            const toolCallId = 'tool-127';
            const snapshot = service.captureFileSnapshot(toolCallId, 'edit', { path: testFile });
            const tempFile = snapshot.tempFilePath;
            
            expect(fs.existsSync(tempFile)).to.be.true;
            service.cleanupSnapshot(toolCallId);
            expect(fs.existsSync(tempFile)).to.be.false;
        });
        
        it('should handle cleanup of non-existent snapshot gracefully', () => {
            expect(() => service.cleanupSnapshot('nonexistent')).to.not.throw();
        });
    });
});
