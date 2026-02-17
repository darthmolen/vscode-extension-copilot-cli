---
id: png-output-probe
category: vision-output
timeout: 120000
expectedBehavior:
  - Check if model can generate PNG/raster images
  - Observe tool usage for image rendering or code execution
  - Check file output format (PNG vs SVG fallback)
bugSymptoms:
  - Model only generates SVG
  - No code execution tools available
---

Generate a PNG image of a simple bar chart with 3 bars: Red=40, Blue=70, Green=55. Save it as a PNG file, not SVG.
