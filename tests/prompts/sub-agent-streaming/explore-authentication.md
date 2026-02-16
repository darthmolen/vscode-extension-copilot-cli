---
id: explore-authentication
category: explore-agent
timeout: 60000
expectedBehavior:
  - Agent should dispatch an 'explore' sub-agent
  - Main message should show 'dispatching sub-agent...' or similar
  - Sub-agent output should stream smoothly in real-time (not in batches)
  - Messages should merge seamlessly into conversation
  - User sees continuous progress updates
bugSymptoms:
  - Long pause after 'dispatching' message
  - Messages arrive in chunks/bursts instead of smoothly
  - Feels laggy compared to normal responses
---

Use the explore agent to search the codebase and find all authentication-related code. Tell me how authentication works in this extension.
