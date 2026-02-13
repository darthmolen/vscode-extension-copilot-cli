import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../../logger';

/**
 * Model capabilities information from the SDK
 */
export interface ModelCapabilities {
    supports: {
        vision: boolean;
        reasoningEffort: boolean;
    };
    limits: {
        max_prompt_tokens?: number;
        max_context_window_tokens: number;
        vision?: {
            supported_media_types: string[];
            max_prompt_images: number;
            max_prompt_image_size: number;
        };
    };
}

/**
 * Model information from SDK
 */
export interface ModelInfo {
    id: string;
    name: string;
    capabilities: ModelCapabilities;
}

/**
 * Validation result
 */
export interface ValidationResult {
    valid: boolean;
    error?: string;
    mimeType?: string;
}

/**
 * Service for managing model capabilities and attachment validation.
 * 
 * This service is client-level (not session-level):
 * - Caches model capabilities to avoid repeated SDK calls
 * - Provides validation for image attachments
 * - Can be shared across multiple sessions
 */
export class ModelCapabilitiesService {
    private logger: Logger;
    private client: any | null = null;
    private capabilitiesCache: Map<string, ModelCapabilities> = new Map();
    private allModelsCache: ModelInfo[] | null = null;
    
    constructor() {
        this.logger = Logger.getInstance();
    }
    
    /**
     * Set the Copilot SDK client (for testing)
     */
    public setClient(client: any): void {
        this.client = client;
    }
    
    /**
     * Initialize the service with a Copilot SDK client
     */
    public async initialize(client: any): Promise<void> {
        this.client = client;
        this.logger.info('[ModelCapabilitiesService] Initialized');
    }
    
    /**
     * Fetch and cache all available models from the SDK
     */
    private async fetchAllModels(): Promise<ModelInfo[]> {
        if (this.allModelsCache) {
            this.logger.debug('[ModelCapabilitiesService] Returning cached models');
            return this.allModelsCache;
        }
        
        if (!this.client) {
            throw new Error('ModelCapabilitiesService not initialized. Call initialize() first.');
        }
        
        this.logger.info('[ModelCapabilitiesService] Fetching models from SDK...');
        const models = await this.client.listModels();
        this.allModelsCache = models;
        
        // Cache individual model capabilities
        for (const model of models) {
            this.capabilitiesCache.set(model.id, model.capabilities);
        }
        
        this.logger.info(`[ModelCapabilitiesService] Cached ${models.length} models`);
        return models;
    }
    
    /**
     * Get capabilities for a specific model
     */
    public async getCapabilities(modelId: string): Promise<ModelCapabilities | null> {
        // Check cache first
        if (this.capabilitiesCache.has(modelId)) {
            this.logger.debug(`[ModelCapabilitiesService] Cache hit for model: ${modelId}`);
            return this.capabilitiesCache.get(modelId)!;
        }
        
        // Fetch all models if not cached
        const models = await this.fetchAllModels();
        const model = models.find(m => m.id === modelId);
        
        if (!model) {
            this.logger.warn(`[ModelCapabilitiesService] Model not found: ${modelId}`);
            return null;
        }
        
        return model.capabilities;
    }
    
    /**
     * Get all available models
     */
    public async getAllModels(): Promise<ModelInfo[]> {
        return this.fetchAllModels();
    }
    
    /**
     * Clear the capabilities cache (useful for testing or when SDK updates)
     */
    public clearCache(): void {
        this.capabilitiesCache.clear();
        this.allModelsCache = null;
        this.logger.info('[ModelCapabilitiesService] Cache cleared');
    }
    
    /**
     * Check if a model supports vision/image attachments
     */
    public async supportsVision(modelId: string): Promise<boolean> {
        const capabilities = await this.getCapabilities(modelId);
        return capabilities?.supports?.vision ?? false;
    }
    
    /**
     * Get maximum number of images allowed per message for a model
     */
    public async getMaxImages(modelId: string): Promise<number> {
        const capabilities = await this.getCapabilities(modelId);
        return capabilities?.limits?.vision?.max_prompt_images ?? 0;
    }
    
    /**
     * Get maximum image file size in bytes for a model
     */
    public async getMaxImageSize(modelId: string): Promise<number> {
        const capabilities = await this.getCapabilities(modelId);
        return capabilities?.limits?.vision?.max_prompt_image_size ?? 0;
    }
    
    /**
     * Get supported media types for a model
     */
    public async getSupportedMediaTypes(modelId: string): Promise<string[]> {
        const capabilities = await this.getCapabilities(modelId);
        return capabilities?.limits?.vision?.supported_media_types ?? [];
    }
    
    /**
     * Log capabilities for a model (for debugging)
     */
    public async logCapabilities(modelId: string): Promise<void> {
        const capabilities = await this.getCapabilities(modelId);
        
        if (!capabilities) {
            this.logger.warn(`[ModelCapabilities] Model ${modelId} not found`);
            return;
        }
        
        const models = await this.getAllModels();
        const model = models.find(m => m.id === modelId);
        
        const supportsVision = capabilities.supports?.vision ?? false;
        const visionLimits = capabilities.limits?.vision;
        
        this.logger.info(`[ModelCapabilities] Model: ${modelId} (${model?.name || 'Unknown'})`);
        this.logger.info(`[ModelCapabilities]   Vision: ${supportsVision}`);
        
        if (supportsVision && visionLimits) {
            this.logger.info(`[ModelCapabilities]   Max Images: ${visionLimits.max_prompt_images}`);
            this.logger.info(`[ModelCapabilities]   Max Size: ${(visionLimits.max_prompt_image_size / 1024 / 1024).toFixed(2)} MB`);
            this.logger.info(`[ModelCapabilities]   Supported Types: ${visionLimits.supported_media_types.join(', ')}`);
        }
    }
    
    /**
     * Validate attachment count against model limits
     */
    public async validateAttachmentCount(modelId: string, count: number): Promise<ValidationResult> {
        const supportsVision = await this.supportsVision(modelId);
        
        if (!supportsVision) {
            return { valid: false, error: 'Current model does not support image attachments' };
        }
        
        const maxImages = await this.getMaxImages(modelId);
        if (count > maxImages) {
            return { 
                valid: false, 
                error: `Too many images. Maximum ${maxImages} image${maxImages > 1 ? 's' : ''} allowed per message.` 
            };
        }
        
        return { valid: true };
    }
    
    /**
     * Validate attachment size against model limits
     */
    public async validateAttachmentSize(modelId: string, sizeInBytes: number, filename: string): Promise<ValidationResult> {
        const supportsVision = await this.supportsVision(modelId);
        
        if (!supportsVision) {
            return { valid: false, error: 'Current model does not support image attachments' };
        }
        
        const maxSize = await this.getMaxImageSize(modelId);
        if (sizeInBytes > maxSize) {
            const sizeMB = (sizeInBytes / 1024 / 1024).toFixed(2);
            const maxSizeMB = (maxSize / 1024 / 1024).toFixed(2);
            return { 
                valid: false, 
                error: `Image too large: ${filename} (${sizeMB} MB > ${maxSizeMB} MB max)` 
            };
        }
        
        return { valid: true };
    }
    
    /**
     * Validate attachment file type against model's supported types
     */
    public async validateAttachmentType(modelId: string, filePath: string): Promise<ValidationResult> {
        const supportsVision = await this.supportsVision(modelId);
        
        if (!supportsVision) {
            return { valid: false, error: 'Current model does not support image attachments' };
        }
        
        const ext = path.extname(filePath).toLowerCase();
        
        // Map file extensions to MIME types
        const mimeTypeMap: { [key: string]: string } = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.webp': 'image/webp',
            '.gif': 'image/gif',
            '.heic': 'image/heic',
            '.heif': 'image/heif'
        };
        
        const mimeType = mimeTypeMap[ext];
        if (!mimeType) {
            return { 
                valid: false, 
                error: `Unsupported file type: ${ext}. Supported: .jpg, .jpeg, .png, .webp, .gif, .heic, .heif` 
            };
        }
        
        const supportedTypes = await this.getSupportedMediaTypes(modelId);
        if (!supportedTypes.includes(mimeType)) {
            const supportedExts = supportedTypes
                .map(type => Object.keys(mimeTypeMap).find(ext => mimeTypeMap[ext] === type))
                .filter(Boolean)
                .join(', ');
            return { 
                valid: false, 
                error: `Format ${ext} not supported by current model. Supported: ${supportedExts}` 
            };
        }
        
        return { valid: true, mimeType };
    }
    
    /**
     * Validate all attachments (count, size, and type)
     * Returns first validation error encountered
     */
    public async validateAttachments(modelId: string, filePaths: string[]): Promise<ValidationResult> {
        // Check count
        const countResult = await this.validateAttachmentCount(modelId, filePaths.length);
        if (!countResult.valid) {
            return countResult;
        }
        
        // Check each file
        for (const filePath of filePaths) {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                return { valid: false, error: `File not found: ${path.basename(filePath)}` };
            }
            
            // Check type
            const typeResult = await this.validateAttachmentType(modelId, filePath);
            if (!typeResult.valid) {
                return typeResult;
            }
            
            // Check size
            const stats = fs.statSync(filePath);
            const sizeResult = await this.validateAttachmentSize(modelId, stats.size, path.basename(filePath));
            if (!sizeResult.valid) {
                return sizeResult;
            }
        }
        
        return { valid: true };
    }
}
