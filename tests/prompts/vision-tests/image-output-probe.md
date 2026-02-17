---
id: image-output-probe
category: vision-output
timeout: 120000
expectedBehavior:
  - Observe what event types contain image data
  - Check if images come as base64 in text, file paths, or content blocks
  - Check tool execution results for image artifacts
bugSymptoms:
  - No image data in any event
  - SDK returns only text description
---

Generate a simple diagram showing a box labeled "Extension" connected by an arrow to a box labeled "Webview". Output the image.
