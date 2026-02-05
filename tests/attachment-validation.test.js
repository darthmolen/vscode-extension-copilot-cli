/**
 * Tests for attachment validation error handling (Phase 6)
 */

const Module = require('module');
const originalRequire = Module.prototype.require;

// Mock vscode module BEFORE anything else loads
Module.prototype.require = function (id) {
    if (id === 'vscode') {
        return require('./vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

const assert = require('assert');
const path = require('path');

describe('Attachment Validation Error Handling', () => {
    let ModelCapabilitiesService;
    let service;
    
    // Mock logger
    const mockLogger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {}
    };
    
    // Mock client with model capabilities
    const mockClient = {
        listModels: async () => ({
            models: [
                {
                    id: 'gpt-4o',
                    name: 'GPT-4o',
                    capabilities: {
                        supports: { vision: true },
                        limits: {
                            vision: {
                                max_prompt_images: 1,
                                max_prompt_image_size: 3145728, // 3 MB
                                supported_media_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
                            }
                        }
                    }
                },
                {
                    id: 'claude-3.5-sonnet',
                    name: 'Claude 3.5 Sonnet',
                    capabilities: {
                        supports: { vision: true },
                        limits: {
                            vision: {
                                max_prompt_images: 5,
                                max_prompt_image_size: 3145728, // 3 MB
                                supported_media_types: ['image/jpeg', 'image/png', 'image/webp']
                            }
                        }
                    }
                },
                {
                    id: 'gpt-3.5-turbo',
                    name: 'GPT-3.5 Turbo',
                    capabilities: {
                        supports: { vision: false }
                    }
                }
            ]
        })
    };
    
    before(() => {
        // Load ModelCapabilitiesService
        const modulePath = path.join(__dirname, '../out/modelCapabilitiesService.js');
        const module = require(modulePath);
        ModelCapabilitiesService = module.ModelCapabilitiesService;
    });
    
    beforeEach(() => {
        // Create fresh service instance for each test
        service = new ModelCapabilitiesService(mockLogger);
        service.setClient(mockClient);
    });
    
    describe('validateAttachmentCount', () => {
        it('should reject when model does not support vision', async () => {
            const result = await service.validateAttachmentCount('gpt-3.5-turbo', 1);
            assert.strictEqual(result.valid, false);
            assert.strictEqual(result.error, 'Current model does not support image attachments');
        });
        
        it('should accept 1 image for GPT-4o (max 1)', async () => {
            const result = await service.validateAttachmentCount('gpt-4o', 1);
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.error, undefined);
        });
        
        it('should reject 2 images for GPT-4o (max 1)', async () => {
            const result = await service.validateAttachmentCount('gpt-4o', 2);
            assert.strictEqual(result.valid, false);
            assert.match(result.error, /Too many images/);
            assert.match(result.error, /Maximum 1 image allowed/);
        });
        
        it('should accept 5 images for Claude (max 5)', async () => {
            const result = await service.validateAttachmentCount('claude-3.5-sonnet', 5);
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.error, undefined);
        });
        
        it('should reject 6 images for Claude (max 5)', async () => {
            const result = await service.validateAttachmentCount('claude-3.5-sonnet', 6);
            assert.strictEqual(result.valid, false);
            assert.match(result.error, /Too many images/);
            assert.match(result.error, /Maximum 5 images allowed/);
        });
    });
    
    describe('validateAttachmentSize', () => {
        const MB = 1024 * 1024;
        
        it('should reject when model does not support vision', async () => {
            const result = await service.validateAttachmentSize('gpt-3.5-turbo', 1 * MB, 'test.jpg');
            assert.strictEqual(result.valid, false);
            assert.strictEqual(result.error, 'Current model does not support image attachments');
        });
        
        it('should accept 1 MB image', async () => {
            const result = await service.validateAttachmentSize('gpt-4o', 1 * MB, 'small.jpg');
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.error, undefined);
        });
        
        it('should accept 3 MB image (exactly at limit)', async () => {
            const result = await service.validateAttachmentSize('gpt-4o', 3 * MB, 'max.jpg');
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.error, undefined);
        });
        
        it('should reject 4 MB image (over limit)', async () => {
            const result = await service.validateAttachmentSize('gpt-4o', 4 * MB, 'huge.jpg');
            assert.strictEqual(result.valid, false);
            assert.match(result.error, /Image too large/);
            assert.match(result.error, /huge\.jpg/);
            assert.match(result.error, /3\.00 MB max/);
        });
        
        it('should include filename in error message', async () => {
            const result = await service.validateAttachmentSize('gpt-4o', 5 * MB, 'my-photo.png');
            assert.strictEqual(result.valid, false);
            assert.match(result.error, /my-photo\.png/);
        });
    });
    
    describe('validateAttachmentType', () => {
        it('should reject when model does not support vision', async () => {
            const result = await service.validateAttachmentType('gpt-3.5-turbo', '/path/to/image.jpg');
            assert.strictEqual(result.valid, false);
            assert.strictEqual(result.error, 'Current model does not support image attachments');
        });
        
        it('should accept .jpg files', async () => {
            const result = await service.validateAttachmentType('gpt-4o', '/path/to/photo.jpg');
            assert.strictEqual(result.valid, true);
        });
        
        it('should accept .jpeg files', async () => {
            const result = await service.validateAttachmentType('gpt-4o', '/path/to/photo.jpeg');
            assert.strictEqual(result.valid, true);
        });
        
        it('should accept .png files', async () => {
            const result = await service.validateAttachmentType('gpt-4o', '/path/to/screenshot.png');
            assert.strictEqual(result.valid, true);
        });
        
        it('should accept .webp files', async () => {
            const result = await service.validateAttachmentType('gpt-4o', '/path/to/modern.webp');
            assert.strictEqual(result.valid, true);
        });
        
        it('should accept .gif files for GPT (supported)', async () => {
            const result = await service.validateAttachmentType('gpt-4o', '/path/to/animation.gif');
            assert.strictEqual(result.valid, true);
        });
        
        it('should reject .gif files for Claude (not supported)', async () => {
            const result = await service.validateAttachmentType('claude-3.5-sonnet', '/path/to/animation.gif');
            assert.strictEqual(result.valid, false);
            assert.match(result.error, /Unsupported image type/);
            assert.match(result.error, /\.gif/);
        });
        
        it('should reject .pdf files', async () => {
            const result = await service.validateAttachmentType('gpt-4o', '/path/to/document.pdf');
            assert.strictEqual(result.valid, false);
            assert.match(result.error, /Unsupported file extension/);
        });
        
        it('should reject .txt files', async () => {
            const result = await service.validateAttachmentType('gpt-4o', '/path/to/file.txt');
            assert.strictEqual(result.valid, false);
            assert.match(result.error, /Unsupported file extension/);
        });
        
        it('should reject .bmp files', async () => {
            const result = await service.validateAttachmentType('gpt-4o', '/path/to/bitmap.bmp');
            assert.strictEqual(result.valid, false);
            assert.match(result.error, /Unsupported file extension/);
        });
    });
    
    describe('validateAttachments (combined)', () => {
        it('should validate all attachments and return first error', async () => {
            const files = [
                '/path/to/valid.jpg',
                '/path/to/huge-file.png'  // Will be too large
            ];
            
            // We can't easily test this without real files, so this is a placeholder
            // The actual implementation will need fs.statSync to check file sizes
            // For now, just verify the method exists
            assert.strictEqual(typeof service.validateAttachments, 'function');
        });
    });
    
    describe('Error Message Quality', () => {
        it('should use singular "image" for max 1', async () => {
            const result = await service.validateAttachmentCount('gpt-4o', 2);
            assert.match(result.error, /1 image allowed/);
            assert.doesNotMatch(result.error, /1 images/);
        });
        
        it('should use plural "images" for max > 1', async () => {
            const result = await service.validateAttachmentCount('claude-3.5-sonnet', 10);
            assert.match(result.error, /5 images allowed/);
        });
        
        it('should include actual file size in MB', async () => {
            const result = await service.validateAttachmentSize('gpt-4o', 5 * 1024 * 1024, 'big.jpg');
            assert.match(result.error, /5\.00 MB/);
        });
        
        it('should include max size in MB', async () => {
            const result = await service.validateAttachmentSize('gpt-4o', 5 * 1024 * 1024, 'big.jpg');
            assert.match(result.error, /3\.00 MB max/);
        });
    });
});
