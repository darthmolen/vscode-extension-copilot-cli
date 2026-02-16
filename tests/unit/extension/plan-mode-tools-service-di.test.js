const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock vscode and Logger to avoid extension host deps
class MockEventEmitter { constructor(){ this.events=[]; } fire(data){ this.events.push(data); } }
class MockLogger { debug(){} info(){} warn(){} error(){} static getInstance(){ return new MockLogger(); } }
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id){
  if (id === 'vscode') { return { EventEmitter: MockEventEmitter }; }
  if (id.endsWith('/logger') || id.includes('out/logger')) { return { Logger: MockLogger }; }
  return originalRequire.apply(this, arguments);
};

const ServiceModulePath = path.join(__dirname, '../../..', 'out', 'extension', 'services', 'planModeToolsService.js');
const { PlanModeToolsService } = require(ServiceModulePath);

// Fake snapshot service
class FakeSnapshotService {
  constructor(tmpDir){ this.tmpDir = tmpDir; this.counter = 0; }
  createTempSnapshot(content, baseName){ const p = path.join(this.tmpDir, `${this.counter++}-${baseName}`); fs.writeFileSync(p, content, 'utf-8'); return p; }
  getTempDir(){ return this.tmpDir; }
  cleanupTempFile(p){ if (fs.existsSync(p)) fs.unlinkSync(p); }
}

describe('PlanModeToolsService - DI and update_work_plan diff', () => {
  let testRoot; let sessionId; let snapshotTmp; let emitCalls;
  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-tools-di-'));
    sessionId = 'session-' + Date.now();
    snapshotTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-snapshots-'));
    emitCalls = [];
    // Stub homedir to point to testRoot
    os.homedir = () => testRoot;
  });
  afterEach(() => {
    if (testRoot && fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true, force: true });
    if (snapshotTmp && fs.existsSync(snapshotTmp)) fs.rmSync(snapshotTmp, { recursive: true, force: true });
  });

  it('emits diff with before/after URIs and writes plan.md (first write from empty)', async () => {
    const emitter = new MockEventEmitter();
    const svc = new PlanModeToolsService(sessionId, process.cwd(), emitter, new FakeSnapshotService(snapshotTmp), (d)=>emitCalls.push(d));
    await svc.initialize();
    const tools = svc.getTools();
    const tool = tools.find(t => t.name === 'update_work_plan');
    const content = '# Plan\n\n- Task 1';
    // Ensure session directory exists
    const sessionDir = path.join(testRoot, '.copilot', 'session-state', sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    const res = await tool.handler({ content }, { toolCallId: 't-1' });
    const planPath = path.join(testRoot, '.copilot', 'session-state', sessionId, 'plan.md');
    expect(fs.existsSync(path.dirname(planPath))).to.be.true;
    expect(fs.readFileSync(planPath, 'utf-8')).to.equal(content);
    expect(emitCalls).to.have.length(1);
    expect(emitCalls[0].toolCallId).to.equal('t-1');
    expect(fs.readFileSync(emitCalls[0].beforeUri, 'utf-8')).to.equal('');
    expect(emitCalls[0].afterUri).to.equal(planPath);
  });

  it('captures previous content on second write', async () => {
    const emitter = new MockEventEmitter();
    const svc = new PlanModeToolsService(sessionId, process.cwd(), emitter, new FakeSnapshotService(snapshotTmp), (d)=>emitCalls.push(d));
    await svc.initialize();
    const tool = svc.getTools().find(t => t.name === 'update_work_plan');
    // Ensure session directory exists
    const sessionDir = path.join(testRoot, '.copilot', 'session-state', sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    const first = '# Plan\n\n- One';
    await tool.handler({ content: first }, { toolCallId: 't-a' });
    const second = '# Plan\n\n- Two';
    await tool.handler({ content: second }, { toolCallId: 't-b' });
    expect(emitCalls).to.have.length(2);
    const beforeContent = fs.readFileSync(emitCalls[1].beforeUri, 'utf-8');
    expect(beforeContent).to.equal(first);
  });
});
