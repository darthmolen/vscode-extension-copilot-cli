$ErrorActionPreference = "Stop"

Write-Host "`n`u{1F528} Building extension..." -ForegroundColor Cyan
npm run compile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`n`u{1F4E6} Packaging VSIX..." -ForegroundColor Cyan
npx @vscode/vsce package --no-git-tag-version --allow-star-activation --allow-missing-repository --skip-license 2>&1 |
    Where-Object { $_ -notmatch "WARNING" }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`n`u{1F5D1} Uninstalling old version..." -ForegroundColor Yellow
try { code --uninstall-extension copilot-cli-extension 2>$null } catch {}
# Ignore failure if not installed

Write-Host "`n`u{1F4E5} Installing new version..." -ForegroundColor Green
$Vsix = Get-ChildItem -Filter "copilot-cli-extension-*.vsix" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
code --install-extension $Vsix.FullName
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`n`u{2705} Done! Extension installed: $($Vsix.Name)" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "   1. Reload VS Code window (Ctrl+Shift+P -> 'Developer: Reload Window')"
Write-Host "   2. Open Output panel (Ctrl+Shift+U)"
Write-Host "   3. Select 'Copilot CLI' from the dropdown"
Write-Host "   4. Run command: Ctrl+Shift+P -> 'Copilot CLI: Start Chat Session'"
Write-Host "   5. Watch the logs!"
