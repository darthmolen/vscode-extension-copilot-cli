#!/bin/bash
set -e

echo "🔨 Building extension..."
npm run compile

echo ""
echo "📦 Packaging VSIX..."
npx @vscode/vsce package --no-git-tag-version --allow-star-activation --allow-missing-repository --skip-license 2>&1 | grep -v "WARNING"

echo ""
echo "🗑️  Uninstalling old version..."
code --uninstall-extension copilot-cli-extension 2>/dev/null || true

echo ""
echo "📥 Installing new version..."
VSIX=$(ls -t copilot-cli-extension-*.vsix | head -1)
code --install-extension "$VSIX"

echo ""
echo "✅ Done! Extension installed: $VSIX"
echo ""
echo "📋 Next steps:"
echo "   1. Reload VS Code window (Ctrl+Shift+P -> 'Developer: Reload Window')"
echo "   2. Open Output panel (Ctrl+Shift+U)"
echo "   3. Select 'Copilot CLI' from the dropdown"
echo "   4. Run command: Ctrl+Shift+P -> 'Copilot CLI: Start Chat Session'"
echo "   5. Watch the logs!"
