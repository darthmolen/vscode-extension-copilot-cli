---
id: svg-mermaid-output
category: vision-output
timeout: 90000
expectedBehavior:
  - CLI generates SVG or mermaid diagram code
  - Output is text-based not binary image
  - Can be rendered in browser
bugSymptoms:
  - No SVG or mermaid in response
  - Plain text description only
---

Create a mermaid diagram showing data flow: User Input -> InputArea -> EventBus -> main.js -> WebviewRpcClient -> Extension. Return the mermaid code.
