---
name: Bug report
about: Report something that isn't working as documented
title: "[bug] "
labels: bug
---

**What happened**
A clear description of the bug.

**Expected behavior**
What you expected instead.

**Reproduction**
Steps, and a minimal request if relevant. Redact your provider/gateway keys.

```bash
# curl or SDK snippet that triggers it (keys removed)
```

**Environment**
- Hosted instance or self-hosted?
- If self-hosted: Node version, deploy target (Vercel / other).
- Provider(s) involved (openai, anthropic, groq, …):

**Gateway response headers** (if available)
`x-gateway-provider`, `x-gateway-fallback-count`, `x-gateway-latency-ms`, status code.

**Additional context**
Anything else that helps.
