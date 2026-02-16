const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock Logger to avoid vscode dependency in unit tests
class MockLogger {
  debug() {}
  info() {}
  warn() {}
  error() {}
  static getInstance() { return new MockLogger(); }
}
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id.endsWith('/logger') || id.includes('out/logger')) {
    return { Logger: MockLogger };
  }
  return originalRequire.apply(this, arguments);
};

// Import compiled JS from out directory (pretest compiles TS)
const ServiceModulePath = path.join(__dirname, '../../../..', 'out', 'extension', 'services', 'fileSnapshotService.js');
const { FileSnapshotService } = require(ServiceModulePath);

describe('FileSnapshotService - Custom Snapshot Helpers', () => {
  let service;
  let testDir;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-custom-'));
    service = new FileSnapshotService();
  });

  afterEach(() => {
    if (service) service.dispose();
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('createTempSnapshot()', () => {
    it('creates a temp file with correct content', () => {
      const content = 'hello\nworld';
      const tempPath = service.createTempSnapshot(content, 'plan.md');
      expect(tempPath).to.be.a('string');
      expect(fs.existsSync(tempPath)).to.be.true;
      expect(fs.readFileSync(tempPath, 'utf-8')).to.equal(content);
    });

    it('uses unique filenames per call', () => {
      const a = service.createTempSnapshot('a', 'plan.md');
      const b = service.createTempSnapshot('b', 'plan.md');
      expect(a).to.not.equal(b);
    });
  });

  describe('cleanupTempFile()', () => {
    it('removes existing temp file', () => {
      const tempPath = service.createTempSnapshot('x', 'test.md');
      expect(fs.existsSync(tempPath)).to.be.true;
      service.cleanupTempFile(tempPath);
      expect(fs.existsSync(tempPath)).to.be.false;
    });

    it('handles non-existent paths gracefully', () => {
      expect(() => service.cleanupTempFile('/tmp/does-not-exist-' + Date.now())).to.not.throw();
    });
  });

  describe('getTempDir()', () => {
    it('returns the temp directory path', () => {
      const dir = service.getTempDir();
      expect(dir).to.be.a('string');
      expect(dir.startsWith(path.join(os.tmpdir(), 'copilot-cli-snapshots-'))).to.be.true;
    });
  });
});
