/**
 * Unit tests for MCPConfigurationService
 * TDD: RED -> GREEN -> REFACTOR
 */

const { describe, it, beforeEach } = require('mocha');
const { expect } = require('chai');

// Mock Logger
class MockLogger {
    debug() {}
    info() {}
    warn() {}
    error() {}
    static getInstance() { return new MockLogger(); }
}

// GREEN PHASE: Implement minimal code to pass tests
class MCPConfigurationService {
    constructor(workingDirectory) {
        this.logger = MockLogger.getInstance();
        this.workingDirectory = workingDirectory || '/default/workspace';
    }
    
    expandVariables(obj) {
        if (typeof obj === 'string') {
            return obj.replace(/\$\{workspaceFolder\}/g, this.workingDirectory);
        } else if (Array.isArray(obj)) {
            return obj.map(item => this.expandVariables(item));
        } else if (obj && typeof obj === 'object') {
            const expanded = {};
            for (const [key, value] of Object.entries(obj)) {
                expanded[key] = this.expandVariables(value);
            }
            return expanded;
        }
        return obj;
    }
    
    getEnabledMCPServers(mcpConfig) {
        const enabled = {};
        for (const [name, config] of Object.entries(mcpConfig)) {
            if (config && config.enabled !== false) {
                const { enabled: _, ...serverConfig } = config;
                const expandedConfig = this.expandVariables(serverConfig);
                enabled[name] = expandedConfig;
            }
        }
        return enabled;
    }
}

describe('MCPConfigurationService - TDD', () => {
    let service;
    
    beforeEach(() => {
        service = new MCPConfigurationService('/home/user/workspace');
    });
    
    describe('expandVariables', () => {
        it('should expand ${workspaceFolder} in strings', () => {
            const input = 'path/to/${workspaceFolder}/bin';
            const result = service.expandVariables(input);
            
            expect(result).to.equal('path/to//home/user/workspace/bin');
        });
        
        it('should expand ${workspaceFolder} in objects', () => {
            const input = {
                command: '${workspaceFolder}/script.sh',
                args: ['--config', '${workspaceFolder}/config.json']
            };
            
            const result = service.expandVariables(input);
            
            expect(result.command).to.equal('/home/user/workspace/script.sh');
            expect(result.args[0]).to.equal('--config');
            expect(result.args[1]).to.equal('/home/user/workspace/config.json');
        });
        
        it('should expand ${workspaceFolder} in nested objects', () => {
            const input = {
                server: {
                    path: '${workspaceFolder}/bin/server',
                    config: {
                        root: '${workspaceFolder}/data'
                    }
                }
            };
            
            const result = service.expandVariables(input);
            
            expect(result.server.path).to.equal('/home/user/workspace/bin/server');
            expect(result.server.config.root).to.equal('/home/user/workspace/data');
        });
        
        it('should expand ${workspaceFolder} in arrays', () => {
            const input = [
                '${workspaceFolder}/file1.txt',
                'static/path',
                '${workspaceFolder}/file2.txt'
            ];
            
            const result = service.expandVariables(input);
            
            expect(result[0]).to.equal('/home/user/workspace/file1.txt');
            expect(result[1]).to.equal('static/path');
            expect(result[2]).to.equal('/home/user/workspace/file2.txt');
        });
        
        it('should handle non-string primitives', () => {
            expect(service.expandVariables(123)).to.equal(123);
            expect(service.expandVariables(true)).to.equal(true);
            expect(service.expandVariables(null)).to.equal(null);
        });
    });
    
    describe('getEnabledMCPServers', () => {
        it('should filter out disabled servers', () => {
            const mcpConfig = {
                'server1': { enabled: true, command: 'cmd1' },
                'server2': { enabled: false, command: 'cmd2' },
                'server3': { command: 'cmd3' }
            };
            
            const result = service.getEnabledMCPServers(mcpConfig);
            
            expect(result).to.have.property('server1');
            expect(result).to.not.have.property('server2');
            expect(result).to.have.property('server3');
        });
        
        it('should remove enabled field from output', () => {
            const mcpConfig = {
                'server1': { enabled: true, command: 'cmd1', args: ['--flag'] }
            };
            
            const result = service.getEnabledMCPServers(mcpConfig);
            
            expect(result.server1).to.not.have.property('enabled');
            expect(result.server1).to.have.property('command');
            expect(result.server1).to.have.property('args');
        });
        
        it('should expand variables in server config', () => {
            const mcpConfig = {
                'server1': {
                    enabled: true,
                    command: '${workspaceFolder}/bin/server',
                    args: ['--root', '${workspaceFolder}/data']
                }
            };
            
            const result = service.getEnabledMCPServers(mcpConfig);
            
            expect(result.server1.command).to.equal('/home/user/workspace/bin/server');
            expect(result.server1.args[1]).to.equal('/home/user/workspace/data');
        });
        
        it('should handle empty config', () => {
            const result = service.getEnabledMCPServers({});
            expect(result).to.deep.equal({});
        });
    });
});
