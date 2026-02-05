# Refactoring SDKSessionManager - Service Extraction Plan

## Problem Statement

The `SDKSessionManager` class has grown to **1946 lines** and has accumulated multiple responsibilities beyond its core purpose of managing SDK sessions. We need to extract these responsibilities into focused services.

## Current Status

**SDKSessionManager**: 1946 lines → **1573 lines** (-373 lines after Phase 1) ✅  
**Target**: ~800 lines (need Phase 2 integration to complete)

### Completed Phases ✅
- Phase 0: Legacy cleanup (deleted cliProcessManager.ts, -346 lines)
- Phase 1.1: MessageEnhancementService created
- Phase 1.2: FileSnapshotService created (TDD: 8/8 tests ✅)
- Phase 1.3: MCPConfigurationService created (TDD: 9/9 tests ✅)  
- Phase 1.4: PlanModeToolsService created & integrated (TDD: 22/22 tests ✅)

### Next: Phase 2
Full integration of remaining services into SDKSessionManager to reach ~800 line target.

## Service Architecture

```
SDKSessionManager (~800 lines target)
    ├── MessageEnhancementService ✅
    ├── FileSnapshotService ✅
    ├── MCPConfigurationService ✅
    ├── PlanModeToolsService ✅
    └── ModelCapabilitiesService ✅
```

## Detailed Plan

See original session for full details:
`~/.copilot/session-state/595634c0-a067-4980-bae9-6eafebfb1d8c/plan.md`

## Progress Summary

| Phase | Service | Status | Lines | Tests |
|-------|---------|--------|-------|-------|
| 0 | cliProcessManager deletion | ✅ | -346 | N/A |
| 1.1 | MessageEnhancementService | ✅ | ~140 | Integration |
| 1.2 | FileSnapshotService | ✅ | ~115 | 8/8 ✅ |
| 1.3 | MCPConfigurationService | ✅ | ~70 | 9/9 ✅ |
| 1.4 | PlanModeToolsService | ✅ | ~464 | 22/22 ✅ |
| **Total Phase 1** | | ✅ | **-373** | **39 tests** |

**Commits**: 738e934, 9ce0367, 8df5543, cf6312c, aadcef0, d52a755, 23a0f73

## Next Steps

1. Phase 2: Integrate remaining services (MessageEnhancement, FileSnapshot)
2. Target: SDKSessionManager ~800 lines
3. Verify all tests pass
4. Update documentation
