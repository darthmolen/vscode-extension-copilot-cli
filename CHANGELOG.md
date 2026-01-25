# Change Log

All notable changes to the Copilot CLI Chat extension.

## [1.0.2] - 2026-01-25

### Added
- **Folder-Specific Session Selection** - Sessions now filtered by workspace folder on startup
  - Automatically resumes the most recent session from the current workspace folder
  - Prevents sessions from other projects being selected when opening a workspace
  - Falls back to global latest session if no folder-specific sessions exist
  - New setting: `copilotCLI.filterSessionsByFolder` (default: `true`) to toggle this behavior
  - Session metadata extracted from `events.jsonl` without requiring CLI schema changes

### Changed
- Session selection now workspace-aware by default
- Improved logging for session selection debugging

### Technical
- Created `sessionUtils.ts` module for session metadata operations
- Refactored `loadLastSessionId()` in `cliProcessManager.ts` to use new utility functions
- Performance optimized: only reads first ~2KB of each session's `events.jsonl` file

## [1.0.1] - 2026-01-24

### Documentation
- Updated README with marketplace installation instructions
- Added marketplace badges (version, installs, rating)
- Created comprehensive development guide (HOW-TO-DEV.md)
- Removed roadmap (v1.0 is complete!)
- Fixed outdated F5 debugging instructions (now uses VSIX workflow)
- Improved Quick Start and configuration examples

## [1.0.0] - 2026-01-24

### 🎉 Initial Release

#### Features
- **Interactive Chat Panel** - Dockable webview with full markdown rendering
  - Code blocks with syntax highlighting
  - Lists, headers, links, and formatted text
  - Auto-scrolling and message history
  
- **Session Management**
  - Session dropdown showing all available sessions
  - Resume last session automatically (configurable)
  - Switch between sessions with full history loading
  - Session labels from plan.md or short ID
  - New session button (+) in header
  
- **Complete CLI Integration**
  - Uses Copilot CLI's `--prompt` mode with session resumption
  - Tracks session state via `~/.copilot/session-state/`
  - Loads full conversation history from `events.jsonl`
  - Clean text output (stats footer stripped)
  
- **Full Configuration Support**
  - All Copilot CLI flags configurable
  - YOLO mode (all permissions) - default: true
  - Auto-resume last session - default: true
  - Granular tool, path, and URL permissions
  - 14 AI models to choose from
  - Agent and custom flags support
  
- **Accessibility**
  - Screen reader optimizations
  - ARIA labels and semantic HTML
  - Live regions for dynamic content
  - Keyboard navigation support
  
- **Cross-Platform**
  - Works on Linux, macOS, and Windows
  - Uses cross-platform Node.js APIs
  - Automatic path handling for all platforms

#### Technical Details
- TypeScript with esbuild bundling
- VSIX-based development workflow (F5 debugging broken in VS Code 1.100+)
- Comprehensive logging via Output Channel
- marked.js for markdown rendering
- No dependencies on deprecated `gh copilot` extension

#### Requirements
- VS Code 1.108.1 or higher
- GitHub Copilot CLI (standalone `copilot` command)
- Active Copilot subscription

#### Known Limitations
- No real-time tool execution visibility (trade-off for clean output)
- No structured output API from CLI yet (v0.0.394)
- File change visualization not yet implemented