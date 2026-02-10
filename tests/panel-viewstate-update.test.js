/**
 * Test: Panel viewState change should trigger updateSessionsList()
 * 
 * Bug: When panel is dragged from Process Explorer to main window,
 * workspace context changes but sessions dropdown never refreshes.
 * 
 * Expected: onDidChangeViewState should call updateSessionsList()
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { expect } from 'chai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Panel ViewState Change', () => {
    it('should call updateSessionsList when viewState changes', () => {
        // Read actual source code
        const chatProviderPath = join(__dirname, '..', 'src', 'chatViewProvider.ts');
        const sourceCode = readFileSync(chatProviderPath, 'utf-8');
        
        // Find the onDidChangeViewState handler - match the actual pattern
        const handlerMatch = sourceCode.match(/onDidChangeViewState\s*\(\s*e\s*=>\s*{([\s\S]*?)},\s*null,\s*disposables/);
        
        expect(handlerMatch, 'onDidChangeViewState handler should exist').to.exist;
        
        const handlerBody = handlerMatch[1];
        
        // Verify it calls updateSessionsList
        expect(
            handlerBody,
            'onDidChangeViewState should call updateSessionsList() when panel moves'
        ).to.match(/updateSessionsList\s*\(/);
    });
    
    it('should update dropdown when panel moves between windows', () => {
        // Read actual source code
        const chatProviderPath = join(__dirname, '..', 'src', 'chatViewProvider.ts');
        const sourceCode = readFileSync(chatProviderPath, 'utf-8');
        
        // Find the onDidChangeViewState handler - match the actual pattern
        const handlerMatch = sourceCode.match(/onDidChangeViewState\s*\(\s*e\s*=>\s*{([\s\S]*?)},\s*null,\s*disposables/);
        
        expect(handlerMatch, 'onDidChangeViewState handler should exist').to.exist;
        
        const handlerBody = handlerMatch[1];
        
        // Verify it refreshes the session list (either via updateSessionsList or equivalent)
        const hasUpdateCall = /updateSessionsList/.test(handlerBody);
        
        expect(
            hasUpdateCall,
            'Panel movement should trigger session list refresh to handle workspace context changes'
        ).to.be.true;
    });
});
