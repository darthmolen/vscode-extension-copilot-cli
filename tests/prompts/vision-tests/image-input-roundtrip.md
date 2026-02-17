---
id: image-input-roundtrip
category: vision-input
timeout: 90000
expectedBehavior:
  - SDK accepts image attachment
  - Response references image content
  - Check model capabilities for vision support
bugSymptoms:
  - Attachment rejected
  - Model reports no vision support
---

Describe what you see in the attached image in detail.
